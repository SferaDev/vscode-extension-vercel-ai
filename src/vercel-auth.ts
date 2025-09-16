import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { TOKEN_REFRESH_MARGIN } from './constants';

interface VercelTokenResponse {
    token: string;
}

interface TokenPayload {
    exp: number;
}

interface StoredOidcToken {
    token: string;
    expiresAt: number;
    projectId: string;
    projectName: string;
    teamId?: string;
    teamName?: string;
}

interface Team {
    id: string;
    name: string | null;
    slug: string;
}

interface TeamsResponse {
    teams: Team[];
}

interface Project {
    id: string;
    name: string;
}

interface ProjectsResponse {
    projects: Project[];
}

class VercelOidcTokenError extends Error {
    constructor(message: string, cause?: any) {
        super(message);
        this.name = 'VercelOidcTokenError';
        if (cause) {
            this.cause = cause;
        }
    }
}


function getUserDataDir(): string | null {
    if (process.env.XDG_DATA_HOME) {
        return process.env.XDG_DATA_HOME;
    }

    switch (os.platform()) {
        case 'darwin':
            return path.join(os.homedir(), 'Library/Application Support');
        case 'linux':
            return path.join(os.homedir(), '.local/share');
        case 'win32':
            return process.env.LOCALAPPDATA || null;
        default:
            return null;
    }
}

function getVercelCliDataDir(): string | null {
    const dataDir = getUserDataDir();
    if (dataDir) {
        return path.join(dataDir, 'com.vercel.cli');
    }
    return null;
}


function getVercelCliToken(): string | null {
    const dataDir = getVercelCliDataDir();
    if (!dataDir) {
        return null;
    }

    const tokenPath = path.join(dataDir, 'auth.json');
    if (!fs.existsSync(tokenPath)) {
        return null;
    }

    try {
        const tokenData = fs.readFileSync(tokenPath, 'utf8');
        const authJson = JSON.parse(tokenData);
        return authJson.token || null;
    } catch {
        return null;
    }
}

function getTokenPayload(token: string): TokenPayload {
    try {
        const [, payload] = token.split('.');
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
        return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    } catch {
        throw new VercelOidcTokenError('Invalid JWT token');
    }
}

function isExpired(expiresAt: number): boolean {
    return expiresAt < Date.now() + TOKEN_REFRESH_MARGIN;
}

function createStoredToken(tokenResponse: VercelTokenResponse, projectId: string, projectName: string, teamId?: string, teamName?: string): StoredOidcToken {
    const payload = getTokenPayload(tokenResponse.token);
    return {
        token: tokenResponse.token,
        expiresAt: payload.exp * 1000,
        projectId,
        projectName,
        teamId,
        teamName
    };
}

export function checkVercelCliAvailable(): boolean {
    return getVercelCliToken() !== null;
}

async function getVercelOidcToken(
    authToken: string,
    projectId: string,
    teamId?: string
): Promise<VercelTokenResponse | null> {
    try {
        const url = `https://api.vercel.com/v1/projects/${projectId}/token?source=vercel-oidc-refresh${teamId ? `&teamId=${teamId}` : ''}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${authToken}`,
            },
        });

        if (!res.ok) {
            throw new VercelOidcTokenError(`Failed to refresh OIDC token: ${res.statusText}`);
        }

        const tokenRes = await res.json() as any;

        if (!tokenRes || typeof tokenRes.token !== 'string') {
            throw new VercelOidcTokenError('Invalid token response from Vercel API');
        }

        return tokenRes as VercelTokenResponse;
    } catch (error) {
        if (error instanceof VercelOidcTokenError) {
            throw error;
        }
        throw new VercelOidcTokenError(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

async function selectTeam(authToken: string): Promise<Team | null> {
    try {
        const response = await fetch('https://api.vercel.com/v2/teams', {
            headers: {
                Authorization: `Bearer ${authToken}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch teams: ${response.statusText}`);
        }

        const data = await response.json() as TeamsResponse;

        const options = data.teams.map((team) => ({
            label: team.name || team.slug,
            description: `Team: ${team.slug}`,
            value: { id: team.id, name: team.name, slug: team.slug }
        }));

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select a team or personal account'
        });

        return selected?.value || null;
    } catch (error) {
        throw new VercelOidcTokenError(`Failed to load teams: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

async function selectProject(authToken: string, team: Team | null): Promise<{ id: string; name: string }> {
    try {
        console.log('Loading projects...', team ? `for team ${team.slug}` : 'for personal account');

        const url = team ?
            `https://api.vercel.com/v10/projects?teamId=${team.id}` :
            'https://api.vercel.com/v10/projects';

        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${authToken}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch projects: ${response.statusText}`);
        }

        const data = await response.json() as ProjectsResponse;
        console.log(`Loaded ${data.projects.length} projects`, data.projects.map(p => p.name).join(', '));

        const options = data.projects.map((project) => ({
            label: project.name,
            description: `ID: ${project.id}`,
            value: { id: project.id, name: project.name }
        }));

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select a project'
        });

        if (!selected) {
            throw new VercelOidcTokenError('Project selection is required');
        }

        return selected.value;
    } catch (error) {
        if (error instanceof VercelOidcTokenError) {
            throw error;
        }
        throw new VercelOidcTokenError(`Failed to load projects: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function createInteractiveOidcSession(): Promise<StoredOidcToken> {
    const authToken = getVercelCliToken();
    if (!authToken) {
        throw new VercelOidcTokenError('Vercel CLI not logged in');
    }

    try {
        // Interactive team selection
        const team = await selectTeam(authToken);

        // Interactive project selection
        const project = await selectProject(authToken, team);

        // Create OIDC token
        const newToken = await getVercelOidcToken(authToken, project.id, team?.id);
        if (!newToken) {
            throw new VercelOidcTokenError('Failed to create OIDC token');
        }

        return createStoredToken(newToken, project.id, project.name, team?.id, team?.name || undefined);

    } catch (error) {
        if (error instanceof VercelOidcTokenError) {
            throw error;
        }
        throw new VercelOidcTokenError(`Failed to create interactive OIDC session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function refreshOidcToken(storedToken: StoredOidcToken): Promise<StoredOidcToken> {
    if (!isExpired(storedToken.expiresAt)) {
        return storedToken;
    }

    const authToken = getVercelCliToken();
    if (!authToken) {
        throw new VercelOidcTokenError('Vercel CLI not logged in');
    }

    const newToken = await getVercelOidcToken(authToken, storedToken.projectId, storedToken.teamId);
    if (!newToken) {
        throw new VercelOidcTokenError('Failed to refresh OIDC token');
    }

    return createStoredToken(newToken, storedToken.projectId, storedToken.projectName, storedToken.teamId, storedToken.teamName);
}

