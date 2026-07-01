# ⚙️ VexCAD AI CAM Engine (FastAPI Backend)

The Python FastAPI backend service that orchestrates the machine-intelligence and manufacturing layer of VexCAD. It analyzes 3D STEP files, extracts machinable features, generates intelligent multi-axis setup plans, creates simulation-ready toolpaths, and outputs production G-Code.

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

### 1. Feature Recognition & Geometry Mapping
The engine uses Python boundary representation (B-Rep) libraries to analyze incoming STEP files. It automatically detects and parameterizes manufacturing features such as:
- Drilling holes (blind, through, countersunk)
- Pocketing and facing
- Boss and contour milling
- Turning profiles (shafts, cylinders)

### 2. Intelligent Setup Planning
Based on the provided Machine Profile (3-Axis, 4-Axis Indexed, 5-Axis, Lathe, Mill-Turn), the backend analyzes the tool approach axis for every feature:
- Calculates alignment against the base setup.
- Automatically clusters features into minimal setups (e.g., rotary indexing operations vs flip/reclamp).
- Blocks features that the active machine cannot support.

### 3. Toolpath Generation & G-Code Post-Processing
- Assigns tools from the Tool Library and generates detailed `ToolpathSegment` sequences for 3D simulation.
- Executes G-Code compilation via post-processors to convert spatial toolpaths into physical machine controller commands.

### 2. Isolated Surgical Refinement (`/edit`)
Editing existing code presents different context requirements than creating a model from scratch. To prevent prompt dilution, editing is decoupled:
- **State Constraints**: Takes the current active code and prompt. The model is guided by `EDIT_SYSTEM_PROMPT` to surgically modify existing modules, keeping parameter headers (`// PARAMETERS_START/END`) intact, and returning the entire updated file.
- **Spatial Injection**: If click-coordinates are passed, the backend automatically formats and injects them as an absolute spatial boundary override: `[System Context: The user clicked X, Y, Z. Use as origin/target]`.

### 4. Readiness Evaluation & Safety Guards
Before generating G-Code, the CAM Readiness Evaluator checks:
- Stale or modified toolpaths
- Blocked operations (e.g. missing capabilities or tool length collisions)
- Prevents generating unsafe/incomplete code.

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

### 1. CAM Pipeline API
Endpoints for the CAM workflow including setup planning, feature extraction, toolpaths, and G-Code generation:

* `POST /api/v1/cam/auto-plan` - Analyzes a STEP file and returns initial Setup Plans and recognized features.
* `POST /api/v1/cam/toolpaths` - Generates simulation-ready toolpath coordinate lists based on the active setups and tools.
* `POST /api/v1/cam/gcode` - Compiles toolpaths into machine-specific G-Code.
* `POST /api/v1/cam/simulate` - Evaluates cycle times and material removal rates.

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

- **[ ] OpenCASCADE Advanced Blending**: Enhancing feature extraction for complex fillets and chamfers.
- **[ ] Adaptive Toolpaths (HSM)**: Implementing constant-engagement high-speed machining clearing strategies.
- **[ ] Multi-Part Assembly Support**: Processing and nesting multiple STEP components for batch manufacturing.
