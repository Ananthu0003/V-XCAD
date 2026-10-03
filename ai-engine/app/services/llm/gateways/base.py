import logging
from pathlib import Path
import httpx
from app.models.domain import ModelMetadata

LOG_DIR = Path(__file__).resolve().parents[4] / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

llm_logger = logging.getLogger("llm_generator")
llm_logger.setLevel(logging.INFO)

if not llm_logger.handlers:
    file_handler = logging.FileHandler(LOG_DIR / "llm_generator.log", encoding="utf-8")
    formatter = logging.Formatter("[%(asctime)s] %(levelname)s [%(name)s]: %(message)s")
    file_handler.setFormatter(formatter)
    llm_logger.addHandler(file_handler)

logger = llm_logger

http_client = httpx.AsyncClient(
    timeout=httpx.Timeout(180.0, connect=20.0),
    limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
)


class BaseLLMGateway:
    def __init__(self) -> None:
        self.logger = llm_logger

    async def generate(
        self,
        prompt: str,
        metadata: ModelMetadata,
        system_instruction: str = "",
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        response_json: bool = False,
    ) -> str:
        raise NotImplementedError("Subclasses must implement generate")

    async def generate_stream(
        self,
        prompt: str,
        metadata: ModelMetadata,
        system_instruction: str = "",
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
    ):
        raise NotImplementedError("Subclasses must implement generate_stream")
