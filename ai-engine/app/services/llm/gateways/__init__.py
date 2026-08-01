import os
from typing import AsyncGenerator
from app.models.domain import ModelMetadata
from app.services.llm.gateways.base import BaseLLMGateway, logger
from app.services.llm.gateways.google import GoogleGateway
from app.services.llm.gateways.openrouter import OpenRouterGateway
from app.services.llm.gateways.ollama import OllamaGateway

class UniversalHTTPXGateway(BaseLLMGateway):
    def __init__(self) -> None:
        super().__init__()
        from dotenv import dotenv_values
        from pathlib import Path
        env_path = Path(__file__).resolve().parents[4] / ".env"
        env_dict = dotenv_values(env_path)
        
        self.google_api_key = env_dict.get("GOOGLE_API_KEY") or os.getenv("GOOGLE_API_KEY", "")
        self.openrouter_api_key = env_dict.get("OPENROUTER_API_KEY") or os.getenv("OPENROUTER_API_KEY", "")
        self.ollama_host = env_dict.get("OLLAMA_HOST") or os.getenv("OLLAMA_HOST", "http://localhost:11434")

        openrouter_gw = OpenRouterGateway(self.openrouter_api_key)
        google_gw = GoogleGateway(self.google_api_key) if self.google_api_key else openrouter_gw
        print(f"DEBUG: google_api_key length: {len(self.google_api_key)}, type of google gateway: {type(google_gw)}")

        self._gateways = {
            "google": google_gw,
            "openai": openrouter_gw,
            "deepseek": openrouter_gw,
            "anthropic": openrouter_gw,
            "openrouter": openrouter_gw,
            "ollama": OllamaGateway(self.ollama_host),
        }

    async def generate(
        self,
        prompt: str,
        metadata: ModelMetadata,
        system_instruction: str = "",
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        response_json: bool = False,
    ) -> str:
        vendor = metadata.vendor
        gateway = self._gateways.get(vendor)
        if not gateway:
            logger.error(f"Unsupported vendor '{vendor}' requested.")
            raise ValueError(f"Unsupported vendor: {vendor}")
        
        return await gateway.generate(
            prompt=prompt,
            metadata=metadata,
            system_instruction=system_instruction,
            image_bytes=image_bytes,
            mime_type=mime_type,
            response_json=response_json,
        )

    async def generate_stream(
        self,
        prompt: str,
        metadata: ModelMetadata,
        system_instruction: str = "",
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
    ) -> AsyncGenerator[str, None]:
        vendor = metadata.vendor
        gateway = self._gateways.get(vendor)
        if not gateway:
            logger.error(f"Unsupported vendor '{vendor}' requested.")
            raise ValueError(f"Unsupported vendor: {vendor}")
            
        async for chunk in gateway.generate_stream(
            prompt=prompt,
            metadata=metadata,
            system_instruction=system_instruction,
            image_bytes=image_bytes,
            mime_type=mime_type,
        ):
            yield chunk
