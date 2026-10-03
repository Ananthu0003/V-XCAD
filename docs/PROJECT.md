### 1. The Tech Stack (The "Modern CAD" Stack)

* **Frontend & BFF (Backend-For-Frontend):** Next.js (App Router) + TypeScript + Tailwind CSS.
* **3D Rendering Environment:** Three.js + `@react-three/fiber` + `@react-three/drei` (Handles STL files natively and gracefully).
* **Database & ORM:** PostgreSQL (via Docker) + Prisma (For tracking generation history and artifacts).
* **AI & Geometry Engine (Backend):** Python + FastAPI + `uvicorn`.
* **Generative AI:** `google-genai` SDK (Using Gemini 2.5 Flash for blazing-fast inference).
* **CAD Kernel:** `build123d` (Pure Python parametric CAD library, exports to STL/STEP).

---

### 2. The Monorepo Folder Structure

This keeps your frontend, backend, and database orchestration in one place, making it incredibly easy to present and deploy.

```text
cad_copilot/
├── docker-compose.yml           # Spins up PostgreSQL instantly
├── web-ui/                      # ⚛️ Next.js App (Frontend & Proxy)
│   ├── prisma/
│   │   └── schema.prisma        # Database schema for CAD sessions
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   ├── generate/route.ts  # Proxies Multipart/SSE to FastAPI
│   │   │   │   └── render/route.ts    # Proxies JSON to FastAPI
│   │   │   ├── globals.css
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx         # Main 3D Workspace UI
│   │   ├── components/          # Canvas, Chat, Parameter Drawer
│   │   ├── lib/                 # Prisma client instance
│   │   └── types/               # TypeScript models (matching backend)
│   ├── package.json
│   └── .env                     # DATABASE_URL, FASTAPI_URL=http://localhost:8000/api/v1
│
└── ai-engine/                   # 🐍 FastAPI Backend
    ├── outputs/                 # Directory where generated .stl/.step files land
    ├── app/
    │   ├── main.py              # FastAPI app init, StaticFiles mount for /outputs
    │   ├── api/
    │   │   └── v1/router.py     # Endpoints: /generate (SSE) and /render
    │   ├── core/config.py
    │   ├── models/schemas.py    # Pydantic models (RenderRequest, etc.)
    │   └── services/
    │       ├── llm_codegen.py   # google-genai integration
    │       ├── cad_execution.py # build123d subprocess runner
    │       └── parameter_render.py # Python AST for offline dimension injection
    ├── requirements.txt
    └── .env                     # GEMINI_API_KEY
```

---

### 3. The Build Strategy

To build this from scratch without the AI getting confused, you must enforce a strict **Back-to-Front** strategy.

1.  **Phase 1: The Engine (Python).** You build the FastAPI app first. You make sure it can talk to Gemini, write a `build123d` script, save an STL, and stream the response. You also lock in the AST parameter injection.
2.  **Phase 2: The Glue (Next.js BFF & Postgres).** You spin up Postgres and Prisma. Then, you write the Next.js API routes that do nothing but act as pass-through proxies to the Python engine.
3.  **Phase 3: The Face (React UI).** You bring in the Three.js canvas and the Chat UI, hooking them up to the endpoints you just created.

---

### 4. The Agentic Prompts

Copy and paste these prompts sequentially into your Agentic IDE (Cursor, Windsurf, or Copilot Workspace). **Do not run the next prompt until the current one is fully working.**

#### Prompt 1: The AI Geometry Engine (FastAPI)
> **Role:** Expert Python Systems Engineer.
> **Context:** I am building a Docs-to-CAD backend from scratch in a folder called `ai-engine`.
> **Task:** Create a FastAPI backend that handles generative CAD via the `google-genai` SDK and `build123d`.
> 1.  **Dependencies:** Generate a `requirements.txt` with `fastapi`, `uvicorn`, `google-genai`, `build123d`, `pydantic`, and `python-multipart`.
> 2.  **App Setup (`app/main.py`):** Initialize FastAPI with CORS enabled. Crucially, mount an `/outputs` directory using `StaticFiles` so generated STL/STEP files can be fetched via HTTP.
> 3.  **Generative Service (`app/services/llm_codegen.py`):** Write a service that takes a prompt and an image, calls Gemini (using `google-genai`), and forces it to output a `build123d` Python script with a top-level `PARAMETERS` dictionary.
> 4.  **Offline Renderer (`app/services/parameter_render.py`):** Write a service that takes a JSON dictionary of parameters and a Python string. Use Python's `ast` module to safely overwrite the `PARAMETERS` dictionary inside the string, and run the script in a subprocess to generate new STL/STEP files in the `/outputs` folder.
> 5.  **Router (`app/api/v1/router.py`):** Create `POST /generate` (accepts multipart file + prompt, returns SSE streaming response) and `POST /render` (accepts JSON parameters, returns instantly).

#### Prompt 2: The Database & API Proxy (Next.js BFF)
> **Role:** Expert Full-Stack Next.js Developer.
> **Context:** We are building the `web-ui` frontend that interfaces with the Python backend we just built.
> **Task:** Set up the database and the Next.js API proxy routes.
> 1.  **Docker & Prisma:** Create a `docker-compose.yml` for PostgreSQL in the root directory. Initialize Prisma in `web-ui`. Create a `CadSession` model with fields for prompt, pythonScript, parameters (JSON), stlUrl, and stepUrl. Provide the command to push this schema.
> 2.  **Proxy Route 1 (`app/api/generate/route.ts`):** Write a Next.js POST route. It must accept `multipart/form-data` from the client, log a new session in Prisma, and use `fetch` to proxy the exact `FormData` to `process.env.FASTAPI_URL/generate`. **CRITICAL:** Pipe the Server-Sent Events (SSE) stream perfectly back to the client without buffering.
> 3.  **Proxy Route 2 (`app/api/render/route.ts`):** Write a POST route that accepts JSON (`python_script`, `parameters`, `session_id`). Proxy this to the FastAPI `/render` endpoint. Update the `CadSession` in Prisma with the newly returned STL URL, and return the JSON to the client.

#### Prompt 3: The 3D UI & Workspace (React)
> **Role:** Expert React and Three.js UX Developer.
> **Context:** The backend and API proxies are complete. Now we build the frontend.
> **Task:** Create the main 3D CAD workspace in `app/page.tsx` using `@react-three/fiber` and Tailwind CSS.
> 1.  **Layout:** Create a modern, dark-themed 3-pane layout: Chat on the left, large 3D Viewport in the center, and a collapsible Parameters Drawer on the right.
> 2.  **Chat Integration:** The chat input must post the file and text to `/api/generate`. Consume the SSE stream to show the AI's response in real-time. Use `react-markdown` to format the chat bubbles.
> 3.  **Viewport Integration:** Use `@react-three/fiber` and `STLLoader` from `three-stdlib`. When the API returns an `stlUrl`, the canvas must load and render the 3D model automatically. Add basic lighting and `OrbitControls`.
> 4.  **Offline Parameter Sync:** The Parameters Drawer must parse the returned parameters. When the user edits them and clicks "Sync to Engine", fire a request to `/api/render`. Show an optimistic "Recompiling Geometry..." overlay on the 3D canvas until the new STL URL is returned.

Feed those into your agent, and you will have a fully functioning, highly original Text/Docs-to-CAD platform built exactly your way.
