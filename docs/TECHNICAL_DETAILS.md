# Technical Details

This document captures implementation-level behavior for CAD Copilot.

## 1. System Boundaries

### 1.1 web-ui (Next.js)

Responsibilities:

- Client UI/UX (chat, parameter drawer, code editor, viewer)
- API proxy and normalization layer (BFF)
- Session persistence through Prisma

Key files:

- web-ui/components/HitlWorkspace.tsx
- web-ui/app/api/generate/route.ts
- web-ui/app/api/render/route.ts
- web-ui/prisma/schema.prisma

### 1.2 ai-engine (FastAPI)

Responsibilities:

- Generate build123d scripts using Gemini
- Parse and enforce parameter replacement
- Execute script and export STL/STEP
- Serve artifacts via static files

Key files:

- ai-engine/app/main.py
- ai-engine/app/api/v1/router.py
- ai-engine/app/services/llm_codegen.py
- ai-engine/app/services/parameter_render.py
- ai-engine/app/models/schemas.py

## 2. End-to-End Request Flows

## 2.1 Generate Flow (Prompt + Upload -> Script)

1. Browser submits multipart form to web-ui POST /api/generate
2. web-ui validates prompt and upload MIME
3. web-ui creates CadSession row in Postgres (prompt only at first)
4. web-ui proxies request to ai-engine /api/v1/generate with accept: text/event-stream
5. ai-engine validates MIME (image/\* or PDF)
6. ai-engine LLMCodegenService streams tokens from Gemini
7. ai-engine emits SSE events:
    - status
    - token
    - done (script + parameters)
    - error (if exception)
8. web-ui forwards stream transparently back to browser
9. frontend assembles final script and initializes parameter drawer

SSE framing:

```text
event: token
data: {"chunk":"..."}

```

## 2.2 Render Flow (Edited Params/Code -> STL/STEP)

1. Browser calls web-ui POST /api/render with:
    - python_script
    - parameters
    - session_id
2. web-ui normalizes payload variants via toFastApiRenderRequest
3. web-ui proxies strict JSON to ai-engine /api/v1/render
4. ai-engine render endpoint determines job_id and output_basename
5. ParameterRenderService:
    - parses script AST
    - overwrites top-level PARAMETERS with merged values
    - appends render harness
    - executes temp render script in subprocess
    - verifies output files exist
6. ai-engine returns artifact URLs under response.artifacts
7. web-ui normalizes top-level stl_url and step_url for frontend convenience
8. frontend updates STL/STEP URLs with cache bust query suffix and refreshes viewer

## 3. Data Contracts

### 3.1 ai-engine RenderRequest

From ai-engine/app/models/schemas.py:

- python_script: string, min length 1
- parameters: object
- session_id: optional string

### 3.2 ai-engine RenderResponse

- session_id: string
- status: SUCCESS
- artifacts:
    - step_file_path
    - stl_file_path
    - step_url
    - stl_url
    - script_url
    - python_script
    - parameters[]

### 3.3 web-ui CadSession model

From web-ui/prisma/schema.prisma:

- id (cuid)
- prompt
- pythonScript
- parameters (Json)
- stlUrl
- stepUrl
- createdAt
- updatedAt

## 4. ai-engine Internals

## 4.1 main.py

- Loads ai-engine/.env at startup (lazy import of python-dotenv)
- Creates output directory if missing
- Mounts /outputs as StaticFiles
- Adds permissive CORS for development

## 4.2 llm_codegen.py

Current behavior:

- Single primary model per request
- Retry loop with exponential backoff for retryable errors
- Parses retryDelay hints from upstream message text
- Normalizes raw script response by stripping markdown fences and non-code prefixes

Important prompt constraints enforced in SYSTEM_INSTRUCTION include:

- Mandatory top-level PARAMETERS
- Direct API style for build123d
- Defensive edge selection and fillet/chamfer try/except policy
- Safer dimensional math guidance for positive heights

## 4.3 parameter_render.py

Pipeline:

1. Parse script AST
2. Locate top-level PARAMETERS assignment or annotated assignment
3. Merge existing defaults with edited runtime parameters
4. Unparse modified AST back to Python source
5. Append RENDER_HARNESS for export_step/export_stl
6. Run subprocess with OUTPUT_DIR and OUTPUT_BASENAME environment variables
7. Validate output files exist

Failure modes:

- PARAMETERS missing -> ValueError
- Subprocess non-zero -> RuntimeError with stdout/stderr
- Missing outputs after run -> RuntimeError

## 5. web-ui Internals

## 5.1 HitlWorkspace state model

Critical state:

- pythonScript + pythonScriptRef
- parameters
- sessionId
- stlUrl/stepUrl
- isGenerating/isRecompiling

pythonScriptRef is used to avoid stale closure issues during sync requests.

## 5.2 Artifact freshness strategy

Frontend appends cache bust token when setting artifact URLs after render sync.
This avoids stale STL/STEP loads when filenames are reused by session.

## 5.3 Download strategy

Downloads are performed via fetch -> blob -> object URL -> synthetic anchor click.
This is robust for cross-origin/static file scenarios where direct download links can be inconsistent.

## 5.4 Toast feedback

Sonner is mounted globally in layout and used for:

- successful artifact readiness
- partial artifact generation
- render failures
- download success/failure

## 6. BFF Proxy Notes

## 6.1 /api/generate

- Creates CadSession before upstream call
- Preserves stream mode by returning upstream ReadableStream directly
- Sets x-session-id header for frontend correlation

## 6.2 /api/render

- Supports script/python_script and session_id/output_basename legacy inputs
- Normalizes artifacts.stl_url and artifacts.step_url to top-level response keys
- Upserts CadSession metadata via updateMany then create fallback

## 7. Performance Characteristics

Main latency contributors:

- LLM generation token time
- Python subprocess start-up for render
- build123d kernel operations and export I/O

Current optimization choices:

- no-store on upstream fetches
- SSE pass-through without buffering in Next.js route
- single-model retry strategy to reduce branchy fallback overhead
- static artifact serving through FastAPI

## 8. Reliability and Risk Areas

- LLM output remains probabilistic; invalid geometry/scripts are possible
- Render subprocess execution has no sandbox isolation beyond process boundary
- CORS is broad for development; harden before production
- DATABASE and FASTAPI_URL configuration drift can break BFF pathing

## 9. Production Hardening Recommendations

1. Add request IDs and structured logs across web-ui BFF and ai-engine
2. Add metrics for:
    - generate latency
    - render latency
    - model/provider error categories
3. Add authentication and per-user rate limits
4. Add queue-based render worker if concurrent load increases
5. Add artifact retention/cleanup policy in ai-engine/outputs
6. Add integration tests for SSE contract and render payload normalization

## 10. Useful Local Verification Commands

From repo root:

```bash
docker compose up -d
```

ai-engine:

```bash
cd ai-engine
uvicorn app.main:app --reload
```

web-ui:

```bash
cd web-ui
npm run dev
```

Health check:

```bash
curl http://127.0.0.1:8000/health
```
