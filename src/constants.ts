export const EXTENSION_ID = 'vercelAiGateway';
export const API_KEY_SECRET = `${EXTENSION_ID}.apiKey`;
export const BASE_URL = 'https://ai-gateway.vercel.sh';
export const MODELS_ENDPOINT = '/v1/models';
export const MODELS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const ROLE_MAP: Record<number, 'user' | 'assistant' | 'system'> = {
    0: 'system',
    1: 'user',
    2: 'assistant',
} as const;