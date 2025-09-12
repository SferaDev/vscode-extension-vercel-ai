import * as vscode from 'vscode';
import { VercelAIChatModelProvider } from './provider';

export function activate(context: vscode.ExtensionContext) {
    const provider = new VercelAIChatModelProvider();
    const disposable = vscode.lm.registerLanguageModelChatProvider('vercel', provider);
    context.subscriptions.push(disposable);
}

export function deactivate() {}