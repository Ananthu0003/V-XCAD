# ⚙️ CAD Copilot AI Engine (FastAPI Backend)

The Python FastAPI backend service that orchestrates the machine-intelligence layer of CAD Copilot. It converts natural language prompts, hand-drawn sketches, and blueprint drawings (PDF/images) into clean, parameterized OpenSCAD CAD scripts utilizing the **Google Gemini API**.

---

## 🏗️ Backend Service Architecture

The service acts as a stateless, high-performance API endpoint that isolates heavy LLM context parsing, image reasoning, and codegen sanitization.

```text
               ┌──────────────────────────────────────────────┐
               │              FastAPI Router                  │ (router.py)
               └──────────────────────┬───────────────────────┘
                                      │
                      ┌───────────────┴───────────────┐
                      ▼                               ▼
             ┌─────────────────┐             ┌─────────────────┐
             │ POST /generate  │             │   POST /edit    │
             └────────┬────────┘             └────────┬────────┘
                      │                               │
                      ▼                               ▼
             ┌─────────────────┐             ┌─────────────────┐
             │  Stage 1 Audit  │             │   Target Coord  │
             │  Stage 2 Code   │             │   Injected Code │
             └────────┬────────┘             └────────┬────────┘
                      │                               │
                      └───────────────┬───────────────┘
                                      ▼
                             ┌─────────────────┐
                             │  Gemini SDK     │ (llm_codegen.py)
                             └────────┬────────┘
                                      │
                                      ▼
                             ┌─────────────────┐
                             │  Regex Sanitizer│ (Manifold Stability Guards)
                             └─────────────────┘
```

### 1. Two-Stage Generation Pipeline (`/generate`)
To ensure high accuracy when translating raw files (sketches/PDF blueprints) to 3D code, the engine divides generation into two logical LLM calls:
- **Stage 1: Blueprint Audit**: The image is analyzed using Gemini Vision with `AUDIT_INSTRUCTION`. It extracts a normalized JSON feature-map detailing dimensions, coordinate systems, stack order, and references, checking confidence ratings.
- **Stage 2: Script Synthesis**: The feature-map is combined with the user's prompt and fed into Gemini Text with `SYSTEM_INSTRUCTION`. The LLM synthesizes a clean, standard OpenSCAD script conforming to parameter blocks.

### 2. Isolated Surgical Refinement (`/edit`)
Editing existing code presents different context requirements than creating a model from scratch. To prevent prompt dilution, editing is decoupled:
- **State Constraints**: Takes the current active code and prompt. The model is guided by `EDIT_SYSTEM_PROMPT` to surgically modify existing modules, keeping parameter headers (`// PARAMETERS_START/END`) intact, and returning the entire updated file.
- **Spatial Injection**: If click-coordinates are passed, the backend automatically formats and injects them as an absolute spatial boundary override: `[System Context: The user clicked X, Y, Z. Use as origin/target]`.

### 3. Manifold Stability Safety Guards
LLM-generated code can occasionally contain syntax errors or unstable boolean geometries. Before returning code to the client, a regular-expression safety net is run:
- **$fn Cap**: Caps any resolution setting (`$fn = N`) that exceeds `32` down to `32` to prevent browser freezes in the client's WebAssembly thread.
- **$fn Injection**: If the model forgot to declare `$fn`, `"$fn = 32;"` is automatically prepended.
- **Epsilon Injection**: If a subtractive operation (`difference()`) is found without an `eps` variable, `eps = 0.02;` is injected to prevent co-planar face z-fighting crashes.

---

## 📂 Directory Layout

```text
ai-engine/
├── app/
│   ├── api/
│   │   └── v1/
│   │       ├── __init__.py
│   │       └── router.py      # API Endpoint handlers (/generate, /edit)
│   ├── models/
│   │   ├── __init__.py
│   │   └── schemas.py         # Pydantic Request/Response validation models
│   ├── services/
│   │   ├── __init__.py
│   │   └── llm_codegen.py     # GenAI Client, system prompts, and regex normalization
│   ├── __init__.py
│   └── main.py                # FastAPI Application startup and CORS configuration
├── logs/                      # Service runtime logs
├── outputs/                   # Standard folder for generated STEP/STL assets
├── scripts/
│   └── validate.py            # CLI script to test blueprint audits and codegen locally
├── requirements.txt           # Python library dependencies
└── .env.example               # Environment variables configuration template
```

---

## 🔌 API Reference & Schema Definitions

### 1. `POST /api/v1/generate`
Used to generate new models from scratch.

* **Content-Type**: `multipart/form-data`
* **Parameters**:
  * `prompt` (Form Parameter, Required): Sizing/functional request.
  * `model` (Form Parameter, Optional): Model override (defaults to `gemini-3.1-flash-lite`).
  * `image` (File Upload, Optional): PDF blueprint or blueprint drawing (PNG, JPEG).
* **Response** (`GenerateResponse`):
  ```json
  {
    "openscad_script": "/* planning and code */",
    "parameters": {
      "base_height": 20.0,
      "bore_diameter": 10.0
    }
  }
  ```

### 2. `POST /api/v1/edit`
Surgically edits active code.

* **Content-Type**: `application/json`
* **JSON Request Body** (`EditRequest`):
  ```json
  {
    "prompt": "Increase the shaft height",
    "current_code": "$fn = 32;\nbase_height = 20;\n...",
    "target_point": [0.0, 0.0, 20.0],
    "model": "gemini-3.1-flash-lite"
  }
  ```
* **Response** (`GenerateResponse`):
  ```json
  {
    "openscad_script": "/* Updated OpenSCAD code */",
    "parameters": {
      "base_height": 20.0,
      "bore_diameter": 10.0,
      "shaft_height": 40.0
    }
  }
  ```

### 3. `GET /health`
* **Response**: `{"status": "ok", "version": "2.0.0"}`

---

## 🛠️ Installation & Setup

### 1. Configure the Environment
Ensure you have Python 3.11+ installed. Create a virtual environment and load the dependencies:
```bash
python -m venv .venv

# Activate venv:
# Windows (PowerShell)
.venv\Scripts\Activate.ps1
# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
```

### 2. Set Up Local Environment Variables
Create a `.env` file from the provided example:
```bash
cp .env.example .env
```
Fill in your Google AI key:
```env
GOOGLE_API_KEY=AIzaSy...
GENAI_MODEL=gemini-3.1-flash-lite
```

### 3. Run the Development Server
```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
Test the setup by curling `http://127.0.0.1:8000/health`.

---

## 💻 Tech Stack & Dependencies

* **fastapi & uvicorn**: ASGI web server routing and execution.
* **google-genai**: Official Google GenAI SDK interfacing with Gemini 3.1/3.5 models.
* **pydantic**: Request/Response models parsing.
* **python-dotenv**: Environment configuration manager.

---

## 🔮 Backend Roadmap

Future backend features currently planned:

- **[ ] OpenCASCADE STEP conversion service**: A FastAPI service routing compiled CSG nodes to STEP file configurations.
- **[ ] Local G-Code compilation**: Lightweight parser transforming OpenSCAD coordinates to sliced extrusion lines.
- **[ ] Offline LLM / Ollama Connector**: Integration of local models (e.g. Qwen-Coder-32B) for offline blueprint auditing.
- **[ ] Multi-Part Assembly Parser**: Engine capability to coordinate multiple separate files under a parent assembly manifest.
