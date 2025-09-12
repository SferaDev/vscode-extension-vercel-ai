import { LanguageModelChatMessage, LanguageModelChatTool, LanguageModelInputPart, LanguageModelResponsePart, LanguageModelTextPart, LanguageModelToolCallPart, Progress } from 'vscode';
import { ROLE_MAP } from './constants';
import { jsonSchema, ModelMessage, ToolSet, tool } from 'ai';

export function convertMessageContent(content: LanguageModelInputPart[]): string {
    try {
        const textParts: string[] = [];

        for (const part of content) {
            if (part instanceof LanguageModelTextPart && part.value) {
                textParts.push(part.value);
            }
        }

        return textParts.join('\n').trim();
    } catch {
        return '';
    }
}

export function convertMessages(messages: Array<LanguageModelChatMessage>): Array<ModelMessage> {
    return messages.map(msg => ({
        role: ROLE_MAP[msg.role] || 'user',
        content: convertMessageContent(msg.content)
    }));
}

export function convertTools(tools: readonly LanguageModelChatTool[] = [], progress: Progress<LanguageModelResponsePart>): ToolSet {
    const toolSet: ToolSet = {};

    for (const { name, description, inputSchema } of tools) {
        toolSet[name] = tool({
            description,
            inputSchema: jsonSchema(inputSchema || { type: 'object', properties: {} }),
            execute: async (params) => {
                const callId = 'tool-call-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
                const toolPart = new LanguageModelToolCallPart(callId, name, params);

                progress.report(toolPart);

                return {
                    toolCallId: callId,
                    toolName: name,
                    status: 'delegated_to_vscode',
                    message: `Tool '${name}' was called and delegated to VS Code for execution`
                };
            }
        });
    }

    return toolSet;
}

export function estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
}