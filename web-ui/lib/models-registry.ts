export interface ModelMetadata {
    id: string;
    name: string;
    vendor: 'google' | 'deepseek' | 'anthropic' | 'openai' | 'ollama';
    tier: 'flash' | 'pro' | 'ultra';
    maxTokens: number;
    supportsThinking: boolean;
    fallbackModelId?: string;
    description: string;
    badge: string;
}

export const MODEL_REGISTRY: ModelMetadata[] = [
    {
        id: 'gemini-3.5-flash',
        name: 'Gemini 3.5 Flash',
        vendor: 'google',
        tier: 'flash',
        maxTokens: 1000000,
        supportsThinking: true,
        fallbackModelId: 'gemini-3.5-flash',
        description: 'Google next-gen reasoning model optimized for code and speed.',
        badge: 'thinking',
    },
    {
        id: 'gemini-3.1-flash-lite',
        name: 'Gemini 3.1 Flash Lite',
        vendor: 'google',
        tier: 'flash',
        maxTokens: 256000,
        supportsThinking: false,
        description: 'Ultra-fast, lightweight fallback model for quick edits.',
        badge: 'fast',
    },

    {
        id: 'anthropic/claude-sonnet-5',
        name: 'Claude 5 Sonnet',
        vendor: 'anthropic',
        tier: 'ultra',
        maxTokens: 200000,
        supportsThinking: true,
        fallbackModelId: 'gemini-3.5-flash',
        description: 'Anthropic flagship model for unmatched creative spatial engineering.',
        badge: 'thinking',
    },
    {
        id: 'openai/gpt-4o',
        name: 'GPT-4o',
        vendor: 'openai',
        tier: 'ultra',
        maxTokens: 128000,
        supportsThinking: true,
        fallbackModelId: 'gemini-3.5-flash',
        description: 'OpenAI premier engine for high-fidelity code synthesis.',
        badge: 'thinking',
    },
    {
        id: 'gemma4:31b-cloud',
        name: 'Gemma 4 31B',
        vendor: 'ollama',
        tier: 'pro',
        maxTokens: 32000,
        supportsThinking: false,
        fallbackModelId: 'gemini-3.5-flash',
        description: 'Gemma 4 31B model running locally/cloud via Ollama endpoints.',
        badge: 'local',
    }
];

export function getModelById(id: string): ModelMetadata | undefined {
    return MODEL_REGISTRY.find(m => m.id === id);
}

export function getFallbackModelId(id: string): string {
    const model = getModelById(id);
    return model?.fallbackModelId || 'gemini-3.1-flash-lite';
}
