import * as vscode from 'vscode';
import { VercelAIChatModelProvider } from './provider';
import { EXTENSION_ID } from './constants';

export function activate(context: vscode.ExtensionContext) {
    const provider = new VercelAIChatModelProvider(context);
    const providerDisposable = vscode.lm.registerLanguageModelChatProvider(EXTENSION_ID, provider);
    context.subscriptions.push(providerDisposable);

    const commandDisposable = vscode.commands.registerCommand(`${EXTENSION_ID}.manage`, () => {
        provider.manageApiKey();
    });

    context.subscriptions.push(commandDisposable);
}

export function deactivate() {
}
