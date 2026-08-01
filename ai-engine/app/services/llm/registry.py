from app.models.domain import ModelMetadata

MODEL_REGISTRY = [
    ModelMetadata(
        id='gemini-3.5-flash',
        name='Gemini 3.5 Flash',
        vendor='google',
        tier='flash',
        maxTokens=1000000,
        supportsThinking=True,
        fallbackModelId='gemini-3.5-flash',
        description='Google next-gen reasoning model optimized for code and speed.',
        badge='thinking',
    ),
    ModelMetadata(
        id='gemini-3.1-flash-lite',
        name='Gemini 3.1 Flash Lite',
        vendor='google',
        tier='flash',
        maxTokens=256000,
        supportsThinking=False,
        description='Ultra-fast, lightweight fallback model for quick edits.',
        badge='fast',
    ),
    ModelMetadata(
        id='gemini-3.1-pro',
        name='Gemini 3.1 Pro (High)',
        vendor='google',
        tier='pro',
        maxTokens=2000000,
        supportsThinking=True,
        fallbackModelId='gemini-3.5-flash',
        description='Google flagship reasoning model optimized for complex spatial tasks.',
        badge='thinking',
    ),

    ModelMetadata(
        id='anthropic/claude-sonnet-5',
        name='Claude 5 Sonnet',
        vendor='anthropic',
        tier='ultra',
        maxTokens=200000,
        supportsThinking=True,
        fallbackModelId='gemini-3.5-flash',
        description='Anthropic flagship model for unmatched creative spatial engineering.',
        badge='thinking',
    ),
    ModelMetadata(
        id='openai/gpt-4o',
        name='GPT-4o',
        vendor='openai',
        tier='ultra',
        maxTokens=128000,
        supportsThinking=True,
        fallbackModelId='gemini-3.5-flash',
        description='OpenAI premier engine for high-fidelity code synthesis.',
        badge='thinking',
    ),
    ModelMetadata(
        id='gemma4:31b-cloud',
        name='Gemma 4 31B',
        vendor='ollama',
        tier='pro',
        maxTokens=32000,
        supportsThinking=False,
        fallbackModelId='gemini-3.5-flash',
        description='Gemma 4 31B model running locally/cloud via Ollama endpoints.',
        badge='local',
    )
]

def get_model_by_id(model_id: str) -> ModelMetadata | None:
    for model in MODEL_REGISTRY:
        if model.id == model_id:
            return model
    return None

def get_fallback_model_id(model_id: str) -> str:
    model = get_model_by_id(model_id)
    return model.fallbackModelId if model and model.fallbackModelId else 'gemini-3.5-flash'
