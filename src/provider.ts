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
            console.error('Failed to fetch models from Vercel AI Gateway:', error);
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
                throw new Error("Vercel AI Gateway API key not found");
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
                        const vsAny = vscode as unknown as Record<string, any>;
                        const ThinkingCtor = vsAny["LanguageModelThinkingPart"] as
                            | (new (text: string, id?: string, metadata?: unknown) => unknown)
                            | undefined;
                        if (ThinkingCtor && chunk.delta) {
                            progress.report(
                                new (ThinkingCtor as any)(chunk.delta) as unknown as LanguageModelResponsePart
                            );
                        }
                        break;
                    }
                    case "error": {
                        const errorMessage = (chunk as any).errorText || 'Unknown error occurred';
                        progress.report(new LanguageModelTextPart(`\n\n**Error:** ${errorMessage}\n\n`));
                        break;
                    }
                    default:
                        console.debug('[VercelAI] Ignored stream chunk type:', chunk.type, JSON.stringify(chunk, null, 2));
                        progress.report(new LanguageModelTextPart(" "));
                        break;
                }
            }
        } catch (error) {
            console.error('[VercelAI] Exception during streaming:', error);

            let errorMessage = 'An unexpected error occurred';
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'string') {
                errorMessage = error;
            } else if (error && typeof error === 'object' && 'message' in error) {
                errorMessage = String(error.message);
            }

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
        } else {
            let totalTokens = 0;
            for (const part of text.content) {
                if (part instanceof LanguageModelTextPart) {
                    totalTokens += Math.ceil(part.value.length / 4);
                }
            }
            return totalTokens;
        }
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
                window.showErrorMessage('Failed to authenticate with Vercel AI Gateway. Please try again.');
            }
            return undefined;
        }
    }
}

function convertMessages(
    messages: readonly LanguageModelChatMessage[]
): ModelMessage[] {
    const result = messages.flatMap((msg) => {
        const results: ModelMessage[] = [];
        const role = msg.role === LanguageModelChatMessageRole.User ? 'user' : 'assistant';
        const tools: Record<string, string> = {};

        for (const part of msg.content) {
            if (typeof part === 'object' && part !== null) {
                if ('value' in part && typeof part.value === 'string') {
                    // Text part
                    results.push({ role, content: part.value });
                } else if (part instanceof LanguageModelToolCallPart) {
                    // Tool call part
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
                    // Extract text content from tool result
                    const resultTexts = part.content
                        .filter((resultPart): resultPart is { value: string } =>
                            typeof resultPart === 'object' &&
                            resultPart !== null &&
                            'value' in resultPart
                        )
                        .map(resultPart => resultPart.value);

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

        // Ensure we always have at least one message with content
        if (results.length === 0) {
            console.debug('[VercelAI] Message had no valid content, creating placeholder');
            results.push({ role, content: "" });
        }

        return results;
    }).filter(msg => {
        // Filter out messages with empty or whitespace-only content
        return typeof msg.content === 'string' ? msg.content.trim() :
            Array.isArray(msg.content) ? msg.content.length > 0 : false;
    });

    // Make sure all messages before the first "user" message are "system" and not "assistant"
    const firstUserIndex = result.findIndex(msg => msg.role === 'user');
    for (let i = 0; i < firstUserIndex; i++) {
        if (result[i].role === 'assistant') {
            result[i].role = 'system';
        }
    }

    return result;
}