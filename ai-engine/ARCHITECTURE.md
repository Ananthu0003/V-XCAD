# CAD Copilot AI Engine - Backend Architecture

## Overview

The ai-engine backend processes engineering drawings (PDF/image) and generates precise 3D CAD models using the `build123d` Python library via Google's Gemini AI.

---

## High-Level Architecture

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

## Data Flow

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Input      │    │   Processing│    │  CAD Script │    │    Output   │
│ Drawing     │───▶│   LLM       │───▶│   build123d │───▶│   3D Model  │
│ (Image/PDF) │    │   Analysis  │    │   Execution │    │ (STEP/STL)  │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

### Stage 1: Blueprint Analysis
1. Image bytes → Google GenAI Vision
2. Extract dimensions, tolerances, features
3. Return structured text summary

### Stage 2: Code Generation
1. Summary + Prompt → Google GenAI Text
2. Generate `build123d` script
3. Stream tokens via SSE
4. Normalize output (extract fenced code block)

### Stage 3: Parameter Extraction
1. Parse `PARAMETERS = {...}` from script
2. Convert to typed dict for rendering

### Stage 4: Model Rendering
1. Isolated subprocess with build123d
2. Execute script with parameters
3. Export STEP and STL files
4. Handle errors gracefully

---

## Key Services

### LLMCodegenService (`app/services/llm_codegen.py`)

**Purpose**: Generate CAD scripts from engineering drawings.

**Key Methods**:
- `summarise_blueprint()` - Stage 1: Vision-based analysis
- `stream_build123d_script()` - Stage 2: Stream code generation
- `normalize_script()` - Cleanup and extract code blocks
- `count_tokens()` - Budget management

**Configuration**:
- `max_prompt_tokens` (default: 12000)
- `max_output_tokens` (default: 2048)
- `max_retries` (default: 5)
- `retry_base_delay_seconds` (default: 1.5)

### ParameterRenderService (`app/services/parameter_render.py`)

**Purpose**: Execute generated scripts and produce 3D models.

**Key Methods**:
- `render_to_outputs()` - Main entry point for rendering
- `_parse_worker_error()` - Parse error from subprocess
- `clear_outputs()` - Cleanup previous renders

**Isolation Strategy**:
- Temporary directory for each render
- Environment variables for parameters
- Python subprocess with build123d preloaded

---

## Error Handling

### LLMCodegenService
| Error Type | Handling | User Feedback |
|------------|----------|---------------|
| 429 (Quota) | Retry with backoff | "Model quota exhausted" |
| 503 (Unavailable) | Retry | "Model temporarily unavailable" |
| Token overflow | Early rejection | "Prompt too large" |
| Empty response | Retry | "Empty response from model" |

### ParameterRenderService
| Error Type | Handling | User Feedback |
|------------|----------|---------------|
| Timeout (180s) | Raise | "Geometry too complex" |
| Syntax error | Parse traceback | Show Python error line |
| Empty shape | Check namespace | "No exportable shape found" |
| Export failure | Try alternative | Show specific export error |

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

---

## Bottlenecks & Limitations

### Current Bottlenecks
1. **Synchronous Rendering** - `/render` blocks the event loop
2. **Single Model** - No fallback for quota exhaustion
3. **No Caching** - Same prompts regenerate scripts
4. **Sequential Execution** - No parallel render queue

### Known Issues
1. **build123d API Changes** - Version lock required
2. **Python Subprocess** - Overhead for each render
3. **No Progress Tracking** - Users can't see render progress

---

## Future Enhancements

1. **Async Rendering** - Background job queue (Celery/RQ)
2. **Cache Layer** - Redis for script caching
3. **Model Pooling** - Multiple models for failover
4. **Progressive Refinement** - Auto-retry on validation errors
5. **Dataset Validation** - Test against "Datavex dataset"
