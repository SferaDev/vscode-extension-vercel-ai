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
import { EXTENSION_ID } from './constants';

export const VERCEL_AI_AUTH_PROVIDER_ID = EXTENSION_ID;

const SESSIONS_SECRET_KEY = `${VERCEL_AI_AUTH_PROVIDER_ID}.sessions`;
const ACTIVE_SESSION_KEY = `${VERCEL_AI_AUTH_PROVIDER_ID}.activeSession`;

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
        if (!stored) {
            return [];
        }

        try {
            return JSON.parse(stored) as SessionData[];
        } catch {
            await this.context.secrets.delete(SESSIONS_SECRET_KEY);
            return [];
        }
    }

    async createSession(_scopes: readonly string[]): Promise<AuthenticationSession> {
        const sessionName = await this.promptForSessionName();
        if (!sessionName) {
            throw new Error('Session name required');
        }

        const apiKey = await this.promptForApiKey();
        if (!apiKey) {
            throw new Error('API key required');
        }

        const session: SessionData = {
            id: this.generateSessionId(),
            accessToken: apiKey,
            account: { id: 'vercel-ai-user', label: sessionName },
            scopes: []
        };

        const sessions = [...await this.getSessions(), session];
        await this.context.secrets.store(SESSIONS_SECRET_KEY, JSON.stringify(sessions));

        if (sessions.length === 1) {
            await this.setActiveSession(session.id);
        }

        this._sessionChangeEmitter.fire({ added: [session], removed: [], changed: [] });
        window.showInformationMessage('Authentication successful!');
        return session;
    }

    async removeSession(sessionId: string): Promise<void> {
        const sessions = await this.getSessions() as SessionData[];
        const index = sessions.findIndex(s => s.id === sessionId);

        if (index === -1) {
            return;
        }

        const [removed] = sessions.splice(index, 1);
        await this.context.secrets.store(SESSIONS_SECRET_KEY, JSON.stringify(sessions));

        const activeSessionId = await this.getActiveSessionId();
        if (activeSessionId === sessionId) {
            const newActiveSession = sessions.length > 0 ? sessions[0].id : null;
            await this.setActiveSession(newActiveSession);
        }

        this._sessionChangeEmitter.fire({ added: [], removed: [removed], changed: [] });
        window.showInformationMessage('Session removed');
    }

    private async promptForSessionName(): Promise<string | undefined> {
        return window.showInputBox({
            prompt: 'Enter a name for this session',
            placeHolder: 'e.g., Personal, Work, Project Name',
            ignoreFocusOut: true,
            validateInput: (value: string) => {
                if (!value?.trim()) {
                    return 'Session name required';
                }
                return null;
            }
        });
    }

    private async promptForApiKey(): Promise<string | undefined> {
        return window.showInputBox({
            prompt: 'Enter your Vercel AI Gateway API key',
            password: true,
            placeHolder: 'vck_...',
            ignoreFocusOut: true,
            validateInput: (value: string) => {
                if (!value?.trim()) {
                    return 'API key required';
                }
                if (!value.startsWith('vck_')) {
                    return 'API key must start with "vck_"';
                }
                return null;
            }
        });
    }


    private generateSessionId(): string {
        return `${EXTENSION_ID}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }

    async manageAuthentication(): Promise<void> {
        const sessions = await this.getSessions();

        if (sessions.length === 0) {
            await this.createSession([]);
            return;
        }

        const activeSession = await this.getActiveSession();
        const activeSessionName = activeSession ? activeSession.account.label : 'None';

        const options = [
            { label: 'Add new API key', value: 'add' }
        ];

        if (sessions.length > 1) {
            options.push({ label: 'Switch active session', value: 'switch' });
        }

        options.push(
            { label: 'Remove session', value: 'remove' },
            { label: 'Cancel', value: 'cancel' }
        );

        const action = await window.showQuickPick(options, {
            placeHolder: `Active session: ${activeSessionName} - Choose an action`
        });

        switch (action?.value) {
            case 'add':
                await this.createSession([]);
                break;
            case 'switch':
                await this.switchActiveSession();
                break;
            case 'remove':
                if (sessions.length === 1) {
                    await this.removeSession(sessions[0].id);
                } else {
                    const selected = await window.showQuickPick(
                        sessions.map(s => ({ label: s.account.label, value: s.id })),
                        { placeHolder: 'Select session to remove' }
                    );
                    if (selected) {
                        await this.removeSession(selected.value);
                    }
                }
                break;
        }
    }

    async getActiveSession(): Promise<SessionData | null> {
        const sessions = await this.getSessions() as SessionData[];
        if (sessions.length === 0) {
            return null;
        }

        const activeSessionId = await this.getActiveSessionId();
        if (activeSessionId) {
            const activeSession = sessions.find(s => s.id === activeSessionId);
            if (activeSession) {
                return activeSession;
            }
        }

        return sessions[0];
    }

    private async getActiveSessionId(): Promise<string | null> {
        return this.context.globalState.get(ACTIVE_SESSION_KEY, null);
    }

    private async setActiveSession(sessionId: string | null): Promise<void> {
        await this.context.globalState.update(ACTIVE_SESSION_KEY, sessionId);
    }

    private async switchActiveSession(): Promise<void> {
        const sessions = await this.getSessions() as SessionData[];
        if (sessions.length <= 1) {
            window.showInformationMessage('You need at least 2 sessions to switch between them.');
            return;
        }

        const activeSessionId = await this.getActiveSessionId();
        const options = sessions.map(s => ({
            label: s.account.label,
            description: s.id === activeSessionId ? '(currently active)' : '',
            value: s.id
        }));

        const selected = await window.showQuickPick(options, {
            placeHolder: 'Select session to activate'
        });

        if (selected && selected.value !== activeSessionId) {
            await this.setActiveSession(selected.value);
            window.showInformationMessage(`Switched to session: ${selected.label}`);
        }
    }

}
