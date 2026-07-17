import os
from typing import Any, AsyncGenerator

from app.models.domain import ModelMetadata
from .base import BaseLLMGateway, logger

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None 
    types = None

class GoogleGateway(BaseLLMGateway):
    def __init__(self, api_key: str) -> None:
        super().__init__()
        if not genai:
            raise RuntimeError("google-genai SDK not installed.")
        self.api_key = api_key
        self.client = genai.Client(api_key=self.api_key) if self.api_key else None

    def _build_contents(self, prompt: str, image_bytes: bytes | None, mime_type: str | None) -> list[Any]:
        contents: list[Any] = []
        if image_bytes and mime_type:
            contents.append(types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
        contents.append(types.Part.from_text(text=prompt))
        return contents

    def _build_config(self, metadata: ModelMetadata, system_instruction: str, response_json: bool) -> dict[str, Any]:
        config_params: dict[str, Any] = {
            "temperature": 0.0, 
            "max_output_tokens": metadata.maxTokens if metadata.maxTokens else 1000000,
        }
        if system_instruction:
            config_params["system_instruction"] = system_instruction
        if response_json:
            config_params["response_mime_type"] = "application/json"
            
        if "3.5" in metadata.id and metadata.supportsThinking:
            config_params["thinking_config"] = types.ThinkingConfig(thinking_level=types.ThinkingLevel.HIGH)
            
        return config_params

    async def generate(
        self,
        prompt: str,
        metadata: ModelMetadata,
        system_instruction: str = "",
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        response_json: bool = False,
    ) -> str:
        if not self.client:
            raise RuntimeError("GOOGLE_API_KEY environment variable is not configured.")
        
        contents = self._build_contents(prompt, image_bytes, mime_type)
        config_params = self._build_config(metadata, system_instruction, response_json)

        import asyncio
        def _call() -> str:
            response = self.client.models.generate_content(
                model=metadata.id,
                contents=contents,
                config=types.GenerateContentConfig(**config_params),
            )
            return response.text or ""

        return await asyncio.to_thread(_call)

    async def generate_stream(
        self,
        prompt: str,
        metadata: ModelMetadata,
        system_instruction: str = "",
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
    ) -> AsyncGenerator[str, None]:
        if not self.client:
            raise RuntimeError("GOOGLE_API_KEY environment variable is not configured.")
            
        contents = self._build_contents(prompt, image_bytes, mime_type)
        config_params = self._build_config(metadata, system_instruction, response_json=False)

        import asyncio
        def _call_stream():
            return self.client.models.generate_content_stream(
                model=metadata.id,
                contents=contents,
                config=types.GenerateContentConfig(**config_params),
            )

        response_stream = await asyncio.to_thread(_call_stream)
        for chunk in response_stream:
            if chunk.text:
                yield chunk.text
