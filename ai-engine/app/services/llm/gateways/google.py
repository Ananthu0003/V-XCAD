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
            "max_output_tokens": min(metadata.maxTokens, 8192) if metadata.maxTokens else 8192,
        }
        if system_instruction:
            config_params["system_instruction"] = system_instruction
        if response_json:
            config_params["response_mime_type"] = "application/json"
            
        if metadata.supportsThinking:
            try:
                # Dynamic thinking budget
                config_params["thinking_config"] = types.ThinkingConfig(thinking_budget=1024)
            except Exception:
                pass
            
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
        fallback_candidates = [metadata.id, "gemini-3.5-flash-lite", "gemini-3.7-flash", "gemini-2.5-flash", "gemini-2.5-pro"]
        
        def _call() -> str:
            last_err: Exception | None = None
            for candidate in fallback_candidates:
                try:
                    params = dict(config_params)
                    if not candidate.startswith("gemini-3") and not candidate.startswith("gemini-2.5"):
                        params.pop("thinking_config", None)
                    response = self.client.models.generate_content(
                        model=candidate,
                        contents=contents,
                        config=types.GenerateContentConfig(**params),
                    )
                    return response.text or ""
                except Exception as e:
                    last_err = e
                    err_str = str(e).lower()
                    if "thinking" in err_str and "thinking_config" in params:
                        try:
                            params.pop("thinking_config", None)
                            response = self.client.models.generate_content(
                                model=candidate,
                                contents=contents,
                                config=types.GenerateContentConfig(**params),
                            )
                            return response.text or ""
                        except Exception as e2:
                            last_err = e2
                            err_str = str(e2).lower()
                    if "503" in err_str or "unavailable" in err_str or "high demand" in err_str or "404" in err_str or "not found" in err_str:
                        logger.warning(f"Google model {candidate} returned {e}. Trying next fallback candidate...")
                        continue
                    raise e
            if last_err:
                raise last_err
            return ""

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
        fallback_candidates = [metadata.id, "gemini-3.5-flash-lite", "gemini-3.7-flash", "gemini-2.5-flash", "gemini-2.5-pro"]
        
        def _call_stream():
            last_err: Exception | None = None
            for candidate in fallback_candidates:
                try:
                    params = dict(config_params)
                    if not candidate.startswith("gemini-3") and not candidate.startswith("gemini-2.5"):
                        params.pop("thinking_config", None)
                    return self.client.models.generate_content_stream(
                        model=candidate,
                        contents=contents,
                        config=types.GenerateContentConfig(**params),
                    )
                except Exception as e:
                    last_err = e
                    err_str = str(e).lower()
                    if "thinking" in err_str and "thinking_config" in params:
                        try:
                            params.pop("thinking_config", None)
                            return self.client.models.generate_content_stream(
                                model=candidate,
                                contents=contents,
                                config=types.GenerateContentConfig(**params),
                            )
                        except Exception as e2:
                            last_err = e2
                            err_str = str(e2).lower()
                    if "503" in err_str or "unavailable" in err_str or "high demand" in err_str or "404" in err_str or "not found" in err_str:
                        logger.warning(f"Google stream model {candidate} returned {e}. Trying next fallback candidate...")
                        continue
                    raise e
            if last_err:
                raise last_err
            raise RuntimeError("All Google model candidates failed.")

        response_stream = await asyncio.to_thread(_call_stream)
        for chunk in response_stream:
            if chunk.text:
                yield chunk.text
