import { createGatewayProvider } from '@ai-sdk/gateway';
import { jsonSchema, ModelMessage, streamText, tool, ToolSet } from 'ai';
import * as vscode from 'vscode';
import {
    CancellationToken,
    ExtensionContext,
    LanguageModelChatInformation,
    LanguageModelChatMessage,
    LanguageModelChatMessageRole,
    LanguageModelChatProvider,
    LanguageModelChatToolMode,
    LanguageModelResponsePart,
    LanguageModelTextPart,
    LanguageModelToolCallPart,
    LanguageModelToolResultPart,
    Progress,
    ProvideLanguageModelChatResponseOptions,
    authentication,
    window
} from 'vscode';
import { ModelsClient } from "./models";
import { VERCEL_AI_AUTH_PROVIDER_ID } from "./auth";
import { ERROR_MESSAGES } from './constants';

export class VercelAIChatModelProvider implements LanguageModelChatProvider {
    private modelsClient: ModelsClient;

    constructor(private _context: ExtensionContext) {
        this.modelsClient = new ModelsClient();
    }

    async provideLanguageModelChatInformation(
        options: { silent: boolean },
        _token: CancellationToken
    ): Promise<LanguageModelChatInformation[]> {
        const apiKey = await this.getApiKey(options.silent);
        if (!apiKey) {
            return [];
        }

        try {
            return await this.modelsClient.getModels(apiKey);
        } catch (error) {
            console.error(ERROR_MESSAGES.MODELS_FETCH_FAILED, error);
            return [];
        }
    }


    async provideLanguageModelChatResponse(
        model: LanguageModelChatInformation,
        chatMessages: readonly LanguageModelChatMessage[],
        options: ProvideLanguageModelChatResponseOptions,
        progress: Progress<LanguageModelResponsePart>,
        token: CancellationToken
    ): Promise<void> {
        const abortController = new AbortController();
        const abortSubscription = token.onCancellationRequested(() => abortController.abort());

        try {
            const apiKey = await this.getApiKey(false);
            if (!apiKey) {
                throw new Error(ERROR_MESSAGES.API_KEY_NOT_FOUND);
            }

            const gateway = createGatewayProvider({ apiKey });

            const tools: ToolSet = {};
            for (const { name, description, inputSchema } of options.tools || []) {
                tools[name] = tool({
                    name,
                    description,
                    inputSchema: jsonSchema(inputSchema || { type: "object", properties: {} }),
                    execute: async (input, { toolCallId }) => {
                        progress.report(new LanguageModelToolCallPart(toolCallId, name, input));
                        return { toolCallId, name, input };
                    }
                });
            }

            const response = streamText({
                model: gateway(model.id),
                messages: convertMessages(chatMessages),
                toolChoice: options.toolMode === LanguageModelChatToolMode.Auto ? "auto" : "required",
                temperature: options.modelOptions?.temperature ?? 0.7,
                tools,
                abortSignal: abortController.signal,
            });

            for await (const chunk of response.toUIMessageStream()) {
                switch (chunk.type) {
                    case "text-delta":
                        progress.report(new LanguageModelTextPart(chunk.delta));
                        break;
                    case "reasoning-delta": {
                        this.handleReasoningDelta(chunk, progress);
                        break;
                    }
                    case "error": {
                        this.handleErrorChunk(chunk, progress);
                        break;
                    }
                    default:
                        this.handleUnknownChunk(chunk, progress);
                        break;
                }
            }
        } catch (error) {
            console.error('[VercelAI] Exception during streaming:', error);
            const errorMessage = this.extractErrorMessage(error);
            progress.report(new LanguageModelTextPart(`\n\n**Error:** ${errorMessage}\n\n`));
        } finally {
            abortSubscription.dispose();
        }
    }

    async provideTokenCount(
        _model: LanguageModelChatInformation,
        text: string | LanguageModelChatMessage,
        _token: CancellationToken
    ): Promise<number> {
        if (typeof text === "string") {
            return Math.ceil(text.length / 4);
        }

        let totalTokens = 0;
        for (const part of text.content) {
            if (part instanceof LanguageModelTextPart) {
                totalTokens += Math.ceil(part.value.length / 4);
            }
        }
        return totalTokens;
    }


    private async getApiKey(silent: boolean): Promise<string | undefined> {
        try {
            const session = await authentication.getSession(
                VERCEL_AI_AUTH_PROVIDER_ID,
                [],
                { createIfNone: !silent, silent }
            );
            return session?.accessToken;
        } catch (error) {
            if (!silent) {
                console.error('Failed to get authentication session:', error);
                window.showErrorMessage(ERROR_MESSAGES.AUTH_FAILED);
            }
            return undefined;
        }
    }

    private handleReasoningDelta(chunk: any, progress: Progress<LanguageModelResponsePart>): void {
        const vsAny = vscode as unknown as Record<string, any>;
        const ThinkingCtor = vsAny["LanguageModelThinkingPart"] as
            | (new (text: string, id?: string, metadata?: unknown) => unknown)
            | undefined;
        if (ThinkingCtor && chunk.delta) {
            progress.report(
                new (ThinkingCtor as any)(chunk.delta) as unknown as LanguageModelResponsePart
            );
        }
    }

    private handleErrorChunk(chunk: any, progress: Progress<LanguageModelResponsePart>): void {
        const errorMessage = chunk.errorText || 'Unknown error occurred';
        progress.report(new LanguageModelTextPart(`\n\n**Error:** ${errorMessage}\n\n`));
    }

    private handleUnknownChunk(chunk: any, progress: Progress<LanguageModelResponsePart>): void {
        console.debug('[VercelAI] Ignored stream chunk type:', chunk.type, JSON.stringify(chunk, null, 2));
        progress.report(new LanguageModelTextPart(" "));
    }

    private extractErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        if (typeof error === 'string') {
            return error;
        }
        if (error && typeof error === 'object' && 'message' in error) {
            return String(error.message);
        }
        return 'An unexpected error occurred';
    }
}

function convertMessages(messages: readonly LanguageModelChatMessage[]): ModelMessage[] {
    const result = messages.flatMap(convertSingleMessage).filter(isValidMessage);
    fixSystemMessages(result);
    return result;
}

function convertSingleMessage(msg: LanguageModelChatMessage): ModelMessage[] {
    const results: ModelMessage[] = [];
    const role = msg.role === LanguageModelChatMessageRole.User ? 'user' : 'assistant';
    const tools: Record<string, string> = {};

    for (const part of msg.content) {
        if (typeof part === 'object' && part !== null) {
            if (isTextPart(part)) {
                results.push({ role, content: part.value });
            } else if (part instanceof LanguageModelToolCallPart) {
                results.push({
                    role: "assistant",
                    content: [{
                        type: "tool-call",
                        toolName: part.name,
                        toolCallId: part.callId,
                        input: part.input
                    }]
                });
                tools[part.callId] = part.name;
            } else if (part instanceof LanguageModelToolResultPart) {
                const resultTexts = extractToolResultTexts(part);
                if (resultTexts.length > 0) {
                    results.push({
                        role: "tool",
                        content: [{
                            type: "tool-result",
                            toolCallId: part.callId,
                            toolName: tools[part.callId] || "unknown",
                            output: { type: "text", value: resultTexts.join(' ') }
                        }]
                    });
                }
            }
        }
    }

    if (results.length === 0) {
        console.debug('[VercelAI] Message had no valid content, creating placeholder');
        results.push({ role, content: "" });
    }

    return results;
}

function isTextPart(part: any): part is { value: string } {
    return 'value' in part && typeof part.value === 'string';
}

function extractToolResultTexts(part: LanguageModelToolResultPart): string[] {
    return part.content
        .filter((resultPart): resultPart is { value: string } =>
            typeof resultPart === 'object' &&
            resultPart !== null &&
            'value' in resultPart
        )
        .map(resultPart => resultPart.value);
}

function isValidMessage(msg: ModelMessage): boolean {
    return typeof msg.content === 'string' ? msg.content.trim().length > 0 :
        Array.isArray(msg.content) ? msg.content.length > 0 : false;
}

function fixSystemMessages(result: ModelMessage[]): void {
    const firstUserIndex = result.findIndex(msg => msg.role === 'user');
    for (let i = 0; i < firstUserIndex; i++) {
        if (result[i].role === 'assistant') {
            result[i].role = 'system';
        }
    }
}