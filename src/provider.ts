import { gateway, streamText } from 'ai';
import {
    CancellationToken,
    ExtensionContext,
    InputBoxOptions,
    LanguageModelChatInformation,
    LanguageModelChatMessage,
    LanguageModelChatProvider,
    LanguageModelResponsePart,
    LanguageModelTextPart,
    Progress,
    ProvideLanguageModelChatResponseOptions,
    window
} from 'vscode';
import { API_KEY_SECRET } from './constants';
import { ModelsClient } from './models';
import { convertMessageContent, convertMessages, convertTools, estimateTokenCount } from './utils';

export class VercelAIChatModelProvider implements LanguageModelChatProvider {
    private modelsClient: ModelsClient;

    constructor(private context: ExtensionContext) {
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
        messages: Array<LanguageModelChatMessage>,
        options: ProvideLanguageModelChatResponseOptions,
        progress: Progress<LanguageModelResponsePart>,
        token: CancellationToken
    ): Promise<void> {
        const apiKey = await this.getApiKey(false);
        if (!apiKey) {
            progress.report(new LanguageModelTextPart('API key not configured.'));
            return;
        }

        try {
            const abortController = new AbortController();
            if (token.isCancellationRequested) {
                return;
            }

            const cancellationDisposable = token.onCancellationRequested(() => {
                if (!abortController.signal.aborted) {
                    abortController.abort();
                }
            });

            try {
                process.env.AI_GATEWAY_API_KEY = apiKey;

                const convertedMessages = convertMessages(messages);
                if (convertedMessages.length === 0) {
                    progress.report(new LanguageModelTextPart('No valid messages to process.'));
                    return;
                }

                const { textStream } = streamText({
                    model: gateway(model.id),
                    messages: convertedMessages,
                    tools: convertTools(options.tools, progress),
                    abortSignal: abortController.signal,
                });

                let hasContent = false;
                for await (const textPart of textStream) {

                    if (token.isCancellationRequested) {
                        break;
                    }
                    hasContent = true;
                    progress.report(new LanguageModelTextPart(textPart));
                }

                if (!hasContent && !token.isCancellationRequested) {
                    progress.report(new LanguageModelTextPart(''));
                }

            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    return;
                }
                throw error;
            } finally {
                cancellationDisposable.dispose();
            }
        } catch (error) {
            const errorMessage = `Vercel AI Gateway request failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
            progress.report(new LanguageModelTextPart(errorMessage));
        }
    }

    async provideTokenCount(
        _model: LanguageModelChatInformation,
        input: string | LanguageModelChatMessage,
        _token: CancellationToken
    ): Promise<number> {
        const text = typeof input === 'string'
            ? input
            : convertMessageContent(input.content);
        return estimateTokenCount(text);
    }


    private async getApiKey(silent: boolean): Promise<string | undefined> {
        let apiKey = await this.context.secrets.get(API_KEY_SECRET);

        if (!apiKey && !silent) {
            await this.promptForApiKey();
            apiKey = await this.context.secrets.get(API_KEY_SECRET);
        }

        return apiKey;
    }

    async manageApiKey(): Promise<void> {
        const options: InputBoxOptions = {
            prompt: 'Enter your Vercel AI Gateway API key',
            password: true,
            placeHolder: 'vck_...',
            ignoreFocusOut: true
        };

        const apiKey = await window.showInputBox(options);

        if (apiKey) {
            await this.context.secrets.store(API_KEY_SECRET, apiKey);
            window.showInformationMessage('Vercel AI Gateway API key saved successfully!');
        }
    }

    private async promptForApiKey(): Promise<void> {
        const result = await window.showInformationMessage(
            'Vercel AI Gateway API key is required to use Vercel AI models. Would you like to configure it now?',
            'Configure API Key',
            'Cancel'
        );

        if (result === 'Configure API Key') {
            await this.manageApiKey();
        }
    }
}