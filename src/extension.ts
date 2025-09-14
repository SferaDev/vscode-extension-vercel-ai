import * as vscode from 'vscode';
import { VercelAIChatModelProvider } from './provider';
import { EXTENSION_ID } from './constants';
import { VercelAIAuthenticationProvider } from './auth';

export function activate(context: vscode.ExtensionContext) {
    // Register the authentication provider
    const authProvider = new VercelAIAuthenticationProvider(context);
    context.subscriptions.push(authProvider);

    // Register the language model chat provider
    const provider = new VercelAIChatModelProvider(context);
    const providerDisposable = vscode.lm.registerLanguageModelChatProvider(EXTENSION_ID, provider);
    context.subscriptions.push(providerDisposable);

    // Register command to manage authentication
    const commandDisposable = vscode.commands.registerCommand(`${EXTENSION_ID}.manage`, () => {
        authProvider.manageAuthentication();
    });

    context.subscriptions.push(commandDisposable);
}

export function deactivate() {
}
