# LLM Codegen Service - Technical Documentation

## Overview

The `LLMCodegenService` class provides AI-powered CAD script generation using Google's Gemini models. It implements a two-stage generation pipeline:

1. **Blueprint Analysis** - Vision-based feature extraction
2. **Code Generation** - Text-based build123d script generation

## Architecture

```
User Prompt + Image
      ↓
Stage 1: SummariseBlueprint (Gemini Vision)
      ↓
Stage 2: StreamBuild123dScript (Gemini Text)
      ↓
Normalized build123d Code
```

## Key Components

### Core Instructions

| Instruction | Purpose |
|-------------|---------|
| `CORE_INSTRUCTION` | Main CAD generation protocol with mandatory contract |
| `SAFETY_INSTRUCTION` | Topological safety rules for robustness |
| `SUMMARISATION_INSTRUCTION` | Blueprint analysis protocol |
| `FEW_SHOT_EXAMPLES` | Example scripts for few-shot learning |

### Instruction Sections

#### 1. Mandatory Contract
- Parameters in `PARAMETERS = { ... }`
- Function signature: `def build_model(params: dict) -> Part:`
- Feature parity: every dimension mapped to code
- No conversational text in output

#### 2. Phase-Based Construction
1. Main Body
2. Counterbores & Central Bores
3. Stepped Diameters & Shoulders
4. Hole Patterns
5. Slots & Keyways
6. Finishing (fillets/chamfers in try/except)

#### 3. Topological Precision
- Face selection: `.faces().sort_by(Axis.Z)[-1]`
- Advanced selectors: `Select.where(lambda e: e.length > ...)`
- Robust fillet checks: `if edges: fillet(edges, r)`

#### 4. Geometry Rules
- 3D Primitives: `Box`, `Sphere`, `Cylinder` (inside `BuildPart`)
- 2D Primitives: `Rectangle`, `Circle`, `Polygon` (inside `BuildSketch`)
- 1D Primitives: `Line`, `Polyline`, `Spline`, `RadiusArc`, `TangentArc` (inside `BuildLine`)

## Class Reference

### LLMCodegenService

#### `__init__(model: Optional[str] = None)`

Initialize the LLM Codegen Service.

**Parameters:**
- `model`: Model name (e.g., "gemini-3.1-flash-lite"). Defaults to env var `GENAI_MODEL`.

**Raises:**
- `RuntimeError`: If google-genai is not installed or API key is missing.

#### `summarise_blueprint(image_bytes: bytes, image_mime_type: str) -> str`

Stage 1: Extract features and dimensions into a text summary.

**Parameters:**
- `image_bytes`: Raw image bytes (PNG, JPEG, PDF)
- `image_mime_type`: MIME type of the image

**Returns:**
- Text summary of the blueprint analysis

#### `stream_build123d_script(prompt: str, image_bytes: bytes, image_mime_type: str, summary: Optional[str] = None) -> Iterator[str]`

Stage 2: Stream build123d script generation.

**Parameters:**
- `prompt`: User's CAD generation request
- `image_bytes`: Raw image bytes for context
- `image_mime_type`: MIME type of the image
- `summary`: Optional blueprint analysis summary

**Yields:**
- Code tokens as they're generated

**Raises:**
- `RuntimeError`: If generation fails after all retries

#### `normalize_script(script: str) -> str`

Clean and extract Python code from LLM output.

**Parameters:**
- `script`: Raw output from LLM

**Returns:**
- Cleaned Python code string

**Normalization Strategy:**
1. Extract fenced code blocks (```python)
2. Fallback to raw code with backtick trimming
3. Remove conversational text before first code line

#### `_log_diagnostic(prompt: str, raw_output: str, error: Optional[str]) -> None`

Log diagnostic information to a JSON file.

Creates timestamped log files in the logs directory with:
- Timestamp and model used
- Original prompt
- Raw and normalized output
- Any errors encountered

### Static Methods

| Method | Purpose |
|--------|---------|
| `_is_retryable_error()` | Check if error is retryable |
| `_is_transient_error()` | Check for transient unavailability |
| `_is_quota_error()` | Check for quota exhaustion |
| `_is_daily_quota_error()` | Check for daily quota exhaustion |
| `_extract_retry_delay_seconds()` | Extract retry delay from error message |

## Error Handling

### Error Classification

| Error Type | Markers | Classification |
|------------|---------|----------------|
| 429 + quota | `resource_exhausted`, `quota exceeded` | Quota Error |
| 429 + daily | `per day`, `requests per day` | Daily Quota Error |
| 503 + temp | `unavailable`, `temporar` | Transient Error |
| 408, 429, 500, 502, 503, 504 | HTTP status codes | Transient Error |

### Retry Strategy

```python
backoff_delay = retry_base_delay * (2 ** (attempt - 1))
delay = max(backoff_delay, retry_after_seconds)
delay = min(delay, max_retry_delay)
```

## Configuration

| Setting | Environment Variable | Default |
|---------|---------------------|---------|
| Model | `GENAI_MODEL` | `gemini-3.1-flash-lite` |
| Max Retries | `GENAI_MAX_RETRIES` | `5` |
| Max Prompt Tokens | `MAX_PROMPT_TOKENS` | `12000` |
| Max Output Tokens | `MAX_OUTPUT_TOKENS` | `2048` |
| Retry Base Delay | `GENAI_RETRY_BASE_DELAY` | `1.5` |
| Max Retry Delay | `GENAI_MAX_RETRY_DELAY` | `60` |

## Usage Example

```python
from app.services.llm_codegen import LLMCodegenService

# Initialize service
service = LLMCodegenService(model="gemini-3.1-flash-lite")

# Load image
with open("drawing.png", "rb") as f:
    image_bytes = f.read()

# Stage 1: Analyze blueprint
summary = service.summarise_blueprint(image_bytes, "image/png")
print(summary)

# Stage 2: Generate code
script = ""
for chunk in service.stream_build123d_script(
    prompt="Generate a part with 4 mounting holes",
    image_bytes=image_bytes,
    image_mime_type="image/png",
    summary=summary
):
    script += chunk

# Normalize the output
clean_script = service.normalize_script(script)
print(clean_script)
```

## Diagnostics

Log files are written to `logs/cad_gen_<timestamp>_<uuid>.json`:

```json
{
    "timestamp": "2024-01-01T12:00:00.000000",
    "model": "gemini-3.1-flash-lite",
    "prompt": "Generate a part...",
    "raw_output": "```python...",
    "cleaned_output": "from build123d import *...",
    "error": null
}
```
