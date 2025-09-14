import {
    AuthenticationProvider,
    AuthenticationProviderAuthenticationSessionsChangeEvent,
    AuthenticationProviderSessionOptions,
    AuthenticationSession,
    Disposable,
    Event,
    EventEmitter,
    ExtensionContext,
    authentication,
    window
} from 'vscode';

export const VERCEL_AI_AUTH_PROVIDER_ID = 'vercel-ai-gateway';
const SESSIONS_SECRET_KEY = `${VERCEL_AI_AUTH_PROVIDER_ID}.sessions`;
const API_BASE_URL = 'https://ai-gateway.vercel.sh/v1/models';

interface SessionData {
    id: string;
    accessToken: string;
    account: { id: string; label: string };
    scopes: readonly string[];
}

export class VercelAIAuthenticationProvider implements AuthenticationProvider, Disposable {
    private _sessionChangeEmitter = new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();
    private _disposable: Disposable;

    constructor(private readonly context: ExtensionContext) {
        this._disposable = authentication.registerAuthenticationProvider(
            VERCEL_AI_AUTH_PROVIDER_ID,
            'Vercel AI Gateway',
            this,
            { supportsMultipleAccounts: false }
        );
    }

    get onDidChangeSessions(): Event<AuthenticationProviderAuthenticationSessionsChangeEvent> {
        return this._sessionChangeEmitter.event;
    }

    dispose(): void {
        this._disposable.dispose();
        this._sessionChangeEmitter.dispose();
    }

    async getSessions(_scopes?: readonly string[], _options?: AuthenticationProviderSessionOptions): Promise<AuthenticationSession[]> {
        const stored = await this.context.secrets.get(SESSIONS_SECRET_KEY);
        if (!stored) {return [];}
        
        try {
            return JSON.parse(stored) as SessionData[];
        } catch {
            await this.context.secrets.delete(SESSIONS_SECRET_KEY);
            return [];
        }
    }

    async createSession(_scopes: readonly string[]): Promise<AuthenticationSession> {
        const apiKey = await this.promptForApiKey();
        if (!apiKey) {throw new Error('API key required');}

        await this.validateApiKey(apiKey);

        const session: SessionData = {
            id: this.generateSessionId(),
            accessToken: apiKey,
            account: { id: 'vercel-ai-user', label: 'Vercel AI Gateway User' },
            scopes: []
        };

        const sessions = [...await this.getSessions(), session];
        await this.context.secrets.store(SESSIONS_SECRET_KEY, JSON.stringify(sessions));
        
        this._sessionChangeEmitter.fire({ added: [session], removed: [], changed: [] });
        window.showInformationMessage('Authentication successful!');
        return session;
    }

    async removeSession(sessionId: string): Promise<void> {
        const sessions = await this.getSessions() as SessionData[];
        const index = sessions.findIndex(s => s.id === sessionId);
        
        if (index === -1) {return;}
        
        const [removed] = sessions.splice(index, 1);
        await this.context.secrets.store(SESSIONS_SECRET_KEY, JSON.stringify(sessions));
        
        this._sessionChangeEmitter.fire({ added: [], removed: [removed], changed: [] });
        window.showInformationMessage('Session removed');
    }

    private async promptForApiKey(): Promise<string | undefined> {
        return window.showInputBox({
            prompt: 'Enter your Vercel AI Gateway API key',
            password: true,
            placeHolder: 'vck_...',
            ignoreFocusOut: true,
            validateInput: (value: string) => {
                if (!value?.trim()) {return 'API key required';}
                if (!value.startsWith('vck_')) {return 'API key must start with "vck_"';}
                return null;
            }
        });
    }

    private async validateApiKey(apiKey: string): Promise<void> {
        const response = await fetch(API_BASE_URL, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (response.status === 401) {throw new Error('Invalid API key');}
        if (response.status === 403) {throw new Error('Access denied');}
        if (!response.ok) {throw new Error(`Validation failed: ${response.status}`);}
    }

    private generateSessionId(): string {
        return `${VERCEL_AI_AUTH_PROVIDER_ID}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }

    async manageAuthentication(): Promise<void> {
        const sessions = await this.getSessions();
        
        if (sessions.length === 0) {
            await this.createSession([]);
            return;
        }

        const action = await window.showQuickPick([
            { label: 'Add new API key', value: 'add' },
            { label: 'Remove session', value: 'remove' },
            { label: 'Cancel', value: 'cancel' }
        ], { placeHolder: 'Manage authentication' });

        switch (action?.value) {
            case 'add':
                await this.createSession([]);
                break;
            case 'remove':
                if (sessions.length === 1) {
                    await this.removeSession(sessions[0].id);
                } else {
                    const selected = await window.showQuickPick(
                        sessions.map(s => ({ label: s.account.label, value: s.id })),
                        { placeHolder: 'Select session to remove' }
                    );
                    if (selected) {await this.removeSession(selected.value);}
                }
                break;
        }
    }
}
