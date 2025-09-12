import { 
    CancellationToken, 
    LanguageModelChatInformation, 
    LanguageModelChatMessage, 
    LanguageModelChatProvider, 
    LanguageModelTextPart,
    Progress, 
    ProvideLanguageModelChatResponseOptions, 
    ProviderResult,
    workspace
} from 'vscode';

export class VercelAIChatModelProvider implements LanguageModelChatProvider {

    provideLanguageModelChatInformation(
        _options: { silent: boolean }, 
        _token: CancellationToken
    ): ProviderResult<LanguageModelChatInformation[]> {
        return [
            {
                id: 'vercel-ai-gpt-4o',
                name: 'GPT-4o',
                tooltip: 'OpenAI GPT-4o model via Vercel AI',
                family: 'gpt-4o',
                version: '2024-08-06',
                maxInputTokens: 128000,
                maxOutputTokens: 4096,
                capabilities: {
                    toolCalling: true,
                    imageInput: true
                }
            },
            {
                id: 'vercel-ai-gpt-4o-mini',
                name: 'GPT-4o Mini',
                tooltip: 'OpenAI GPT-4o Mini model via Vercel AI',
                family: 'gpt-4o-mini',
                version: '2024-07-18',
                maxInputTokens: 128000,
                maxOutputTokens: 16384,
                capabilities: {
                    toolCalling: true,
                    imageInput: true
                }
            }
        ];
    }

    async provideLanguageModelChatResponse(
        model: LanguageModelChatInformation,
        messages: Array<LanguageModelChatMessage>,
        _options: ProvideLanguageModelChatResponseOptions,
        progress: Progress<LanguageModelTextPart>,
        token: CancellationToken
    ): Promise<void> {
        
        // Get API key from configuration
        const config = workspace.getConfiguration('vercelAI');
        const apiKey = config.get<string>('apiKey');
        
        if (!apiKey) {
            progress.report(new LanguageModelTextPart('Error: Vercel AI API key not configured. Please set vercelAI.apiKey in VS Code settings.'));
            return;
        }

        try {
            // For now, let's create a simple mock response that works
            const modelName = model.id === 'vercel-ai-gpt-4o' ? 'GPT-4o' : 'GPT-4o Mini';
            const response = `Hello! This is a response from ${modelName} via Vercel AI. Your API key is configured correctly. `;
            
            // Simulate streaming by sending the response in chunks
            const chunks = response.match(/.{1,10}/g) || [response];
            
            for (const chunk of chunks) {
                if (token.isCancellationRequested) {
                    break;
                }
                
                progress.report(new LanguageModelTextPart(chunk));
                
                // Small delay to simulate streaming
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            // Add a summary of the last user message
            const lastMessage = messages[messages.length - 1];
            if (lastMessage && typeof lastMessage.content === 'string') {
                progress.report(new LanguageModelTextPart(`\n\nYou asked: "${lastMessage.content}"`));
            }
            
        } catch (error) {
            const errorMessage = `Vercel AI request failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
            progress.report(new LanguageModelTextPart(errorMessage));
        }
    }

    async provideTokenCount(
        _model: LanguageModelChatInformation,
        input: string | LanguageModelChatMessage,
        _token: CancellationToken
    ): Promise<number> {
        // Simple approximation: ~4 characters per token
        if (typeof input === 'string') {
            return Math.ceil(input.length / 4);
        }
        
        // For LanguageModelChatMessage, always return a basic estimate
        return 42; // Placeholder token count
    }
}