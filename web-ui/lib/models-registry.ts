export interface ModelMetadata {
    id: string;
    name: string;
    vendor: 'google' | 'deepseek' | 'anthropic' | 'openai' | 'ollama' | 'openrouter';
    tier: 'flash' | 'pro' | 'ultra';
    maxTokens: number;
    supportsThinking: boolean;
    fallbackModelId?: string;
    description: string;
    badge: string;
}

export const MODEL_REGISTRY: ModelMetadata[] = [
    {
        id: 'gemini-3.7-flash',
        name: 'Gemini 3.7 Flash',
        vendor: 'google',
        tier: 'flash',
        maxTokens: 1000000,
        supportsThinking: true,
        fallbackModelId: 'gemini-3.5-flash',
        description: 'Google latest flagship hybrid reasoning model with dynamic thinking.',
        badge: 'thinking',
    },
    {
        id: 'gemini-3.5-flash',
        name: 'Gemini 3.5 Flash',
        vendor: 'google',
        tier: 'flash',
        maxTokens: 1000000,
        supportsThinking: true,
        fallbackModelId: 'gemini-3.1-flash-lite',
        description: 'Google next-gen reasoning model optimized for code and speed.',
        badge: 'thinking',
    },
    {
        id: 'gemini-3.6-flash',
        name: 'Gemini 3.6 Flash',
        vendor: 'google',
        tier: 'flash',
        maxTokens: 1000000,
        supportsThinking: true,
        fallbackModelId: 'gemini-3.1-flash-lite',
        description: 'Google next-gen model from OpenRouter.',
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
        vendor: 'openrouter',
        tier: 'ultra',
        maxTokens: 200000,
        supportsThinking: true,
        fallbackModelId: 'gemini-3.5-flash',
        description: 'Anthropic flagship model for unmatched creative spatial engineering.',
        badge: 'thinking',
    },
    {
        id: 'anthropic/claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        vendor: 'openrouter',
        tier: 'pro',
        maxTokens: 200000,
        supportsThinking: false,
        fallbackModelId: 'gemini-3.5-flash',
        description: 'Anthropic highly capable and fast model.',
        badge: 'fast',
    },
    {
        id: 'anthropic/claude-3-opus',
        name: 'Claude 3 Opus',
        vendor: 'openrouter',
        tier: 'ultra',
        maxTokens: 200000,
        supportsThinking: false,
        fallbackModelId: 'gemini-3.5-flash',
        description: 'Anthropic highly capable flagship model.',
        badge: 'powerful',
    },
    {
        id: 'anthropic/claude-3.5-haiku',
        name: 'Claude 3.5 Haiku',
        vendor: 'openrouter',
        tier: 'flash',
        maxTokens: 200000,
        supportsThinking: false,
        fallbackModelId: 'gemini-3.5-flash',
        description: 'Anthropic fastest and most compact model.',
        badge: 'fast',
    },
    {
        id: 'anthropic/claude-4.6-opus',
        name: 'Claude Opus 4.6',
        vendor: 'openrouter',
        tier: 'ultra',
        maxTokens: 200000,
        supportsThinking: true,
        fallbackModelId: 'gemini-3.5-flash',
        description: 'Anthropic Opus 4.6 model.',
        badge: 'thinking',
    },
    {
        id: 'anthropic/claude-4.7-opus',
        name: 'Claude Opus 4.7',
        vendor: 'openrouter',
        tier: 'ultra',
        maxTokens: 200000,
        supportsThinking: true,
        fallbackModelId: 'gemini-3.5-flash',
        description: 'Anthropic Opus 4.7 model.',
        badge: 'thinking',
    },
    {
        id: 'anthropic/claude-4.8-opus',
        name: 'Claude Opus 4.8',
        vendor: 'openrouter',
        tier: 'ultra',
        maxTokens: 200000,
        supportsThinking: true,
        fallbackModelId: 'gemini-3.5-flash',
        description: 'Anthropic Opus 4.8 model.',
        badge: 'thinking',
    },
    {
        id: 'anthropic/claude-5-fable',
        name: 'Claude 5 Fable',
        vendor: 'openrouter',
        tier: 'ultra',
        maxTokens: 200000,
        supportsThinking: true,
        fallbackModelId: 'gemini-3.5-flash',
        description: 'Anthropic Claude 5 Fable model.',
        badge: 'thinking',
    },
    {
        id: 'anthropic/claude-opus-5',
        name: 'Claude Opus 5 Max',
        vendor: 'openrouter',
        tier: 'ultra',
        maxTokens: 200000,
        supportsThinking: true,
        fallbackModelId: 'gemini-3.5-flash',
        description: 'Anthropic Claude Opus 5 Max model.',
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
    return model?.fallbackModelId || 'gemini-3.5-flash';
}
