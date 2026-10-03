import json
from typing import Any, AsyncGenerator
from app.models.domain import ModelMetadata
from .base import BaseLLMGateway, http_client
import base64

class OllamaGateway(BaseLLMGateway):
    def __init__(self, host: str) -> None:
        super().__init__()
        self.host = host.rstrip("/")

    def _build_payload(self, prompt: str, metadata: ModelMetadata, system_instruction: str, image_bytes: bytes | None, response_json: bool) -> dict[str, Any]:
        messages = []
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction})

        msg: dict[str, Any] = {"role": "user", "content": prompt}
        if image_bytes:
            msg["images"] = [base64.b64encode(image_bytes).decode("utf-8")]
            
        messages.append(msg)

        payload: dict[str, Any] = {
            "model": metadata.id,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.0
            }
        }
        if metadata.maxTokens:
            payload["options"]["num_predict"] = metadata.maxTokens
            
        if response_json:
            payload["format"] = "json"
            
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
        url = f"{self.host}/api/chat"
        payload = self._build_payload(prompt, metadata, system_instruction, image_bytes, response_json)

        response = await http_client.post(url, json=payload)
        response.raise_for_status()
        res_data = response.json()
        return res_data.get("message", {}).get("content", "")

    async def generate_stream(
        self,
        prompt: str,
        metadata: ModelMetadata,
        system_instruction: str = "",
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
    ) -> AsyncGenerator[str, None]:
        url = f"{self.host}/api/chat"
        payload = self._build_payload(prompt, metadata, system_instruction, image_bytes, response_json=False)
        payload["stream"] = True

        async with http_client.stream("POST", url, json=payload) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line:
                    data = json.loads(line)
                    content = data.get("message", {}).get("content", "")
                    if content:
                        yield content
