import json
import base64
from typing import Any, AsyncGenerator
from app.models.domain import ModelMetadata
from .base import BaseLLMGateway, http_client

class OpenRouterGateway(BaseLLMGateway):
    def __init__(self, api_key: str) -> None:
        super().__init__()
        self.api_key = api_key
        self.base_url = "https://openrouter.ai/api/v1/chat/completions"

    def _build_payload(self, prompt: str, metadata: ModelMetadata, system_instruction: str, image_bytes: bytes | None, mime_type: str | None, response_json: bool) -> dict[str, Any]:
        messages = []
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction})

        user_content: list[dict[str, Any]] = []
        if image_bytes and mime_type:
            b64_data = base64.b64encode(image_bytes).decode("utf-8")
            user_content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{mime_type};base64,{b64_data}"
                }
            })
        user_content.append({"type": "text", "text": prompt})
        messages.append({"role": "user", "content": user_content})

        model_id = metadata.id
        if metadata.vendor == "google" and not model_id.startswith("google/"):
            # Use the exact model ID requested by the user, just prefixed for OpenRouter
            model_id = f"google/{metadata.id}"
        elif metadata.vendor == "google":
            model_id = metadata.id

        payload: dict[str, Any] = {
            "model": model_id,
            "messages": messages,
        }

        # Handle specific model features via standard openAI config
        payload["temperature"] = 0.0
        if metadata.maxTokens:
            payload["max_tokens"] = min(metadata.maxTokens, 8192)

        if response_json:
            payload["response_format"] = {"type": "json_object"}
            
        return payload

    async def generate(
        self,
        prompt: str,
        metadata: ModelMetadata,
        system_instruction: str = "",
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        response_json: bool = False,
    ) -> str:
        if not self.api_key:
            raise RuntimeError("OPENROUTER_API_KEY environment variable is not configured.")
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://vexcad.com", # Required for OpenRouter rankings
            "X-Title": "VexCAD AI Engine" # Required for OpenRouter
        }
        
        payload = self._build_payload(prompt, metadata, system_instruction, image_bytes, mime_type, response_json)

        response = await http_client.post(self.base_url, headers=headers, json=payload)
        if response.status_code != 200:
            raise RuntimeError(f"OpenRouter API Error {response.status_code}: {response.text}")
        response.raise_for_status()
        res_data = response.json()
        return res_data["choices"][0]["message"]["content"] or ""

    async def generate_stream(
        self,
        prompt: str,
        metadata: ModelMetadata,
        system_instruction: str = "",
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
    ) -> AsyncGenerator[str, None]:
        if not self.api_key:
            raise RuntimeError("OPENROUTER_API_KEY environment variable is not configured.")
            
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://vexcad.com",
            "X-Title": "VexCAD AI Engine"
        }
        
        payload = self._build_payload(prompt, metadata, system_instruction, image_bytes, mime_type, response_json=False)
        payload["stream"] = True

        async with http_client.stream("POST", self.base_url, headers=headers, json=payload) as response:
            if response.status_code != 200:
                err_text = await response.aread()
                raise RuntimeError(f"OpenRouter API Error {response.status_code}: {err_text.decode('utf-8', errors='ignore')}")
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line.startswith("data: ") and line != "data: [DONE]":
                    raw_json = line[6:].strip()
                    if not raw_json:
                        continue
                    try:
                        data = json.loads(raw_json)
                        if "choices" in data and len(data["choices"]) > 0:
                            delta = data["choices"][0].get("delta", {})
                            if "content" in delta and delta["content"]:
                                yield delta["content"]
                    except json.JSONDecodeError:
                        print(f"Warning: Failed to parse OpenRouter chunk: {raw_json}")
