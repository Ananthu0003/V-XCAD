# CAD Copilot AI Engine - Complete Overview

## Executive Summary

The CAD Copilot AI Engine is a Python backend service that converts engineering drawings (PDF/images) into precise 3D CAD models using Google's Gemini AI and the build123d library.

### Core Capabilities

| Feature | Description |
|---------|-------------|
| **Two-Stage Generation** | Vision analysis → Text code generation |
| **Streaming Output** | SSE-based real-time token streaming |
| **Isolated Rendering** | Subprocess execution for stability |
| **Error Handling** | Specific, actionable error messages |
| **STEP/STL Export** | Professional CAD format output |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User / Web UI                             │
│                   (Next.js - web-ui)                            │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP/HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FastAPI Application                           │
│                   app/main.py                                    │
│  - CORS, Error Handlers, Health Check                           │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  API Router (v1)                                 │
│              app/api/v1/router.py                                │
│  ┌─────────────────┐        ┌──────────────────┐                │
│  │   /generate     │        │    /render       │                │
│  │  (SSE Stream)   │        │  (Synchronous)   │                │
│  └────────┬────────┘        └────────┬────────┘                │
└───────────┼──────────────────────────┼──────────────────────────┘
            │                          │
            ▼                          ▼
┌────────────────────────────────┐  ┌────────────────────────────┐
│   LLMCodegenService            │  │  ParameterRenderService    │
│  app/services/llm_codegen.py   │  │  app/services/parameter_   │
│                                │  │                        render.py │
│  - Blueprint Analysis          │  │  - Script Validation       │
│  - Code Generation (SSE)       │  │  - Isolated Subprocess     │
│  - Retry Logic & Quota Mgmt    │  │  - Error Handling          │
│  - Prompt Token Budgeting      │  │  - Output Export (STEP/STL)│
│                                │  │                            │
└────────────────────────────────┘  └────────────────────────────┘
            │                          │
            ▼                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Google GenAI SDK                             │
│              gemini-3.1-flash-lite model                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Pipeline

```
Input (Image/PDF)
      ↓
Stage 1: Blueprint Analysis (Gemini Vision)
      ↓ Text Summary with all dimensions/features
Stage 2: Code Generation (Gemini Text)
      ↓ build123d Python Script
Stage 3: Parameter Extraction
      ↓ PARAMETERS dict
Stage 4: 3D Rendering (Subprocess)
      ↓ STEP + STL Files
```

### Stage-by-Stage Breakdown

#### Stage 1: Blueprint Analysis
1. Image bytes sent to Gemini Vision
2. Extract dimensions, tolerances, features
3. Return structured text summary with:
   - Overall dimensions (bounding box)
   - Datum identification
   - Internal topology (counterbores, stepped diameters)
   - Hole patterns (PCD, rectangular)
   - Feature geometry (slots, keyways, fillets)
   - Annotations (thread specs, special markings)

#### Stage 2: Code Generation
1. User prompt + Image + Summary → Gemini Text
2. Generate `build123d` Python script with:
   - PARAMETERS dictionary
   - `build_model(params: dict) -> Part` function
   - Phase-based construction (Main Body → Bores → Holes → Slots → Finishing)
3. Stream tokens via SSE for real-time UI updates

#### Stage 3: Parameter Extraction
1. Parse `PARAMETERS = {...}` from script
2. Extract typed dictionary for rendering

#### Stage 4: 3D Rendering
1. Isolated subprocess with build123d preloaded
2. Execute script with injected parameters
3. Export to STEP and STL formats

---

## Key Services

### LLMCodegenService (`app/services/llm_codegen.py`)

| Method | Purpose |
|--------|---------|
| `summarise_blueprint()` | Stage 1: Vision-based analysis |
| `stream_build123d_script()` | Stage 2: Stream code generation |
| `normalize_script()` | Cleanup and extract code blocks |
| `count_tokens()` | Budget management |

**Configuration**:
- `max_prompt_tokens` (default: 12000)
- `max_output_tokens` (default: 2048)
- `max_retries` (default: 5)
- `retry_base_delay_seconds` (default: 1.5)

### ParameterRenderService (`app/services/parameter_render.py`)

| Method | Purpose |
|--------|---------|
| `render_to_outputs()` | Main entry point for rendering |
| `_parse_worker_error()` | Parse error from subprocess |
| `clear_outputs()` | Cleanup previous renders |

**Isolation Strategy**:
- Temporary directory for each render
- Environment variables for parameters
- Python subprocess with build123d preloaded

---

## API Endpoints

### POST `/api/v1/generate`

Generate a build123d script from an image.

**Request** (multipart/form-data):
- `prompt` (form): Description of what to build
- `image` (file): Engineering drawing (PNG, JPEG, PDF)
- `model_name` (form, optional): Gemini model name

**Response** (SSE):
- `metadata`: Token budget information
- `status`: Processing status messages
- `token`: Code generation chunks
- `done`: Final script and parameters
- `error`: Error details if failed

### POST `/api/v1/render`

Render the generated script to 3D model files.

**Request** (JSON):
```json
{
    "python_script": "from build123d import * ...",
    "parameters": {"diameter": 10.0, "height": 20.0},
    "session_id": "optional_id"
}
```

**Response** (JSON):
```json
{
    "status": "SUCCESS",
    "artifacts": {
        "step_file_path": ".../cad_xxx.step",
        "stl_file_path": ".../cad_xxx.stl"
    }
}
```

---

## Configuration

### Environment Variables (`.env`)

```bash
# Google AI
GOOGLE_API_KEY=your_api_key_here
GENAI_MODEL=gemini-3.1-flash-lite

# LLM Codegen
GENAI_MAX_RETRIES=5
MAX_PROMPT_TOKENS=12000
MAX_OUTPUT_TOKENS=2048
GENAI_RETRY_BASE_DELAY=1.5
GENAI_MAX_RETRY_DELAY=60

# Rendering
OUTPUT_DIR=./outputs
```

### Configuration Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_API_KEY` | Google AI API key | Required |
| `GENAI_MODEL` | Gemini model to use | `gemini-3.1-flash-lite` |
| `GENAI_MAX_RETRIES` | Max retry attempts | `5` |
| `MAX_PROMPT_TOKENS` | Token budget | `12000` |
| `MAX_OUTPUT_TOKENS` | Max output tokens | `2048` |
| `GENAI_RETRY_BASE_DELAY` | Retry base delay (s) | `1.5` |
| `GENAI_MAX_RETRY_DELAY` | Max retry delay (s) | `60` |

---

## Dependencies

### Core Libraries
- `build123d==0.10.0` - Primary CAD kernel
- `google-genai==1.73.1` - Gemini AI client
- `fastapi==0.136.0` - REST API framework
- `python-dotenv==1.2.2` - Environment management

### Supporting Libraries
- `numpy==2.4.4` - Array operations
- `scipy==1.17.1` - Scientific computing
- `pydantic==2.13.2` - Data validation
- `uvicorn==0.44.0` - ASGI server

---

## Quick Start

### 1. Install Dependencies

```bash
cd ai-engine
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your Google AI API key
GOOGLE_API_KEY=your_api_key_here
```

### 3. Run the API Server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Test the Pipeline

```bash
# Using the demo script
python end_to_end_demo.py --image test_image.png --prompt "Generate this part"
```

---

## Error Handling

### LLM Codegen Errors

| Error Type | Handling | User Feedback |
|------------|----------|---------------|
| 429 (Quota) | Retry with backoff | "Model quota exhausted" |
| 503 (Unavailable) | Retry | "Model temporarily unavailable" |
| Token overflow | Early rejection | "Prompt too large" |
| Empty response | Retry | "Empty response from model" |

### Render Service Errors

| Error Type | Handling | User Feedback |
|------------|----------|---------------|
| Timeout (180s) | Raise | "Geometry too complex" |
| Syntax error | Parse traceback | Show Python error line |
| Empty shape | Check namespace | "No exportable shape found" |
| Export failure | Try alternative | Show specific export error |

---

## Usage Example

```python
from app.services.llm_codegen import LLMCodegenService
from app.services.parameter_render import ParameterRenderService, extract_parameters_from_script

# Initialize services
codegen = LLMCodegenService()
render = ParameterRenderService()

# Load image
with open("drawing.png", "rb") as f:
    image_bytes = f.read()

# Stage 1: Analyze
summary = codegen.summarise_blueprint(image_bytes, "image/png")

# Stage 2: Generate
script = "".join(codegen.stream_build123d_script(
    prompt="Generate a housing with 4 mounting holes",
    image_bytes=image_bytes,
    image_mime_type="image/png",
    summary=summary
))

# Stage 3: Extract parameters
params = extract_parameters_from_script(script)

# Stage 4: Render
paths = render.render_to_outputs(
    parameters=params,
    script=codegen.normalize_script(script),
    output_basename="my_part"
)

print(f"Generated: {paths['stl_path']}")
```

---

## Development

### Running Tests

```bash
# Validate with a test image
python scripts/validate.py --image path/to/image.png
```

### Linting

```bash
# Check code style
ruff check .
```

---

## Project Structure

```
ai-engine/
├── app/
│   ├── api/
│   │   └── v1/
│   │       ├── __init__.py
│   │       └── router.py      # FastAPI routes
│   ├── models/
│   │   ├── __init__.py
│   │   └── schemas.py         # Pydantic schemas
│   ├── services/
│   │   ├── __init__.py
│   │   ├── llm_codegen.py     # AI code generation
│   │   └── parameter_render.py # 3D rendering
│   ├── main.py                # FastAPI app
│   └── __init__.py
├── docs/                      # Documentation
│   ├── AI_ENGINE_OVERVIEW.md  # This file
│   ├── ARCHITECTURE.md        # Detailed architecture
│   ├── IMPROVEMENTS.md        # Technical improvements
│   └── end_to_end_demo.md     # Demo script guide
├── logs/                      # Diagnostic logs
├── outputs/                   # Generated 3D models
├── scripts/
│   └── validate.py            # CLI validation tool
├── end_to_end_demo.py         # Complete pipeline demo
├── requirements.txt
└── .env.example
```

---

## License

MIT License - See LICENSE file for details.
