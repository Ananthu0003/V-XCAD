from pydantic import BaseModel, ConfigDict
from typing import Literal, Optional

class ModelMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    vendor: Literal['google', 'deepseek', 'anthropic', 'openai', 'ollama']
    tier: Literal['flash', 'pro', 'ultra']
    maxTokens: int
    supportsThinking: bool
    fallbackModelId: Optional[str] = None
    description: str
    badge: str
