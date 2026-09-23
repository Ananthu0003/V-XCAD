# V-XCAD

An AI-assisted CAD/CAM system: a Next.js web application (`web-ui`) backed by a Python/FastAPI
service (`ai-engine`) that generates parametric CAD geometry from prompts/images via Google
Gemini (with an optional OpenRouter fallback), executes the generated `build123d` scripts under
a restricted execution environment, and drives a CAM pipeline (feature recognition, setup
planning, toolpath generation, simulation, and G-code post-processing) on top of a
PostgreSQL/Prisma persistence layer.

This README documents the repository **as it actually exists** at the current branch
(`fix/V-XCAD-security`, commit `d4ca88a`). Where something could not be verified from source, it
is marked **Unverified** rather than guessed.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Key Features](#2-key-features)
3. [Technology Stack](#3-technology-stack)
4. [System Architecture](#4-system-architecture)
5. [Repository / Directory Structure](#5-repository--directory-structure)
6. [Requirements](#6-requirements)
7. [Environment Variables](#7-environment-variables)
8. [Docker Setup](#8-docker-setup)
9. [Local Development Without Docker](#9-local-development-without-docker)
10. [Database Architecture](#10-database-architecture)
11. [Authentication and Authorization](#11-authentication-and-authorization)
12. [AI / LLM Pipeline](#12-ai--llm-pipeline)
13. [CAD Generation / Rendering Pipeline](#13-cad-generation--rendering-pipeline)
14. [API / Service Communication](#14-api--service-communication)
15. [Security Architecture](#15-security-architecture)
16. [Rate Limiting](#16-rate-limiting)
17. [Testing](#17-testing)
18. [Development Workflow](#18-development-workflow)
19. [Build / Production Deployment](#19-build--production-deployment)
20. [Troubleshooting](#20-troubleshooting)
21. [Common Commands](#21-common-commands)
22. [Project Status / Known Limitations](#22-project-status--known-limitations)
23. [License / Contribution / Contact](#23-license--contribution--contact)

---

## 1. Overview

V-XCAD (product name in the UI: **VΞXCAD**) is a full-stack application for going from a
natural-language prompt (optionally with a reference image or blueprint) to parametric 3D CAD
geometry, and from there through a CAM pipeline to machine-ready G-code.

**What it actually does, end to end:**

1. A user describes a part (text, optionally an image) in the web workspace.
2. `web-ui` forwards the request to `ai-engine`, which calls Google Gemini (or OpenRouter as a
   fallback) to generate a parametric `build123d` Python script.
3. The generated script passes through a static AST security check, then executes in a
   restricted subprocess to produce STL/STEP/DXF geometry.
4. The user can iterate on the script/parameters (a "CAD Prompt Assistant" can compare a
   blueprint image against the current 3D render and suggest a revised prompt).
5. From a generated part, the user can run the CAM pipeline: feature recognition, machine/setup
   planning against a machine-profile capability matrix, toolpath generation, 3D toolpath
   simulation, and G-code post-processing.
6. Sessions, iterations, CAM setups/operations/toolpaths, tools/holders, and knowledge-base
   content are persisted in PostgreSQL via Prisma.

**Intended users:** engineers/designers who want to go from an idea or a 2D blueprint to a
manufacturable part and G-code without hand-authoring CAD/CAM software from scratch, plus an
admin role for reviewing password-reset requests and managing the machining knowledge base.

**High-level architecture** (see [Section 4](#4-system-architecture) for detail): a browser talks
only to `web-ui` (a Next.js app that is also its own Backend-for-Frontend); `web-ui` is the only
publicly-published service and the only service holding session/JWT logic; it proxies
CAD/CAM/AI operations to `ai-engine` over a Docker-internal network using a shared service API
key; both `web-ui` and `ai-engine` talk to PostgreSQL directly, using a least-privilege
application role that a one-shot `migrate` service provisions.

---

## 2. Key Features

Grouped by area, and limited to what is actually implemented in source (route handlers,
services, and Prisma models were used to confirm each item below).

### CAD generation / rendering
- Prompt/image-driven generation of parametric `build123d` Python scripts via Gemini
  (`ai-engine/app/services/llm/llm_codegen.py`, `ai-engine/app/services/llm/parameter_render.py`).
- Static AST security validation of generated scripts before execution
  (`validate_script_syntax` / `validate_script_security`).
- Script execution in a subprocess under a dedicated non-root user (`caduser`) with a curated
  environment and restricted builtins, producing STL/STEP/DXF/G-code artifacts.
- "Edit" / iterative refinement of an existing script rather than regenerating from scratch.

### AI-assisted CAD interaction
- **CAD Prompt Assistant**: multimodal comparison of a reference blueprint image against the
  current 3D viewport render(s), producing a structured discrepancy report and a suggested
  follow-up prompt (`ai-engine/app/services/agents/cad_prompt_assistant.py`,
  `web-ui/components/assistant/PromptAssistantWidget.tsx`).
- Model selection UI with a curated model registry spanning multiple vendors
  (`web-ui/lib/models-registry.ts`, `ai-engine/app/services/llm/registry.py`) — see
  [Section 12](#12-ai--llm-pipeline) for the distinction between this general chat-model registry
  and the CAD Prompt Assistant's own narrower Gemini allowlist.

### Authentication
- Email/password registration and login, JWT session cookies, `tokenVersion`-based session
  invalidation, and an admin-mediated password-reset workflow (no self-service email-link reset
  is implemented — see [Section 11](#11-authentication-and-authorization)).

### Workspace / session management
- CAD sessions with prompt/script/parameter history (`CadSession`, `CadIteration` Prisma
  models), session sharing (`isShared` flag, a dedicated `/share/[id]` page), and per-user
  session listing that also imports orphaned on-disk generated scripts into the database
  (`autoSyncDiskSessions`, `web-ui/app/api/sessions/route.ts`).

### File / output handling
- Generated artifacts (STL/STEP/DXF/G-code/toolpath JSON) are written to a shared runtime
  output directory and served back to the browser through an ownership-checked BFF route
  (`web-ui/app/api/outputs/[...path]/route.ts`) rather than being served directly by `ai-engine`.

### CAM pipeline
- STEP/feature analysis and auto-planning (`/api/cam/analyze`, `/api/cam/auto-plan`).
- Machine recommendation against a machine-profile capability matrix
  (`/api/cam/recommend-machine`).
- Toolpath generation and 3D simulation preparation/playback
  (`/api/cam/toolpaths`, `/api/cam/[jobId]/simulate/prepare`,
  `/api/cam/[jobId]/simulation/[simulationRunId]/**`).
- G-code post-processing (`/api/cam/gcode`).
- A Tool Wizard for defining custom cutting tools and holder assemblies (`web-ui/store`,
  `web-ui/components/tools/wizard/**`), backed by a dedicated tool-library data model
  (`ToolDefinition`, `ToolMaterial`, `ToolCoating`, `ToolHolder`, `CuttingData`, and a second,
  separate `Tool`/`ToolGeometry`/`ToolOffset`/`ToolAssembly` model set — see
  [Section 10](#10-database-architecture)).

### Knowledge / document functionality
- Admin-only ingestion and retrieval of engineering-knowledge documents into a
  PostgreSQL-backed store (`KnowledgeDocument`, `OntologyNode`, `EngineeringRule` Prisma models;
  `ai-engine/app/services/knowledge/repository.py`).

### Admin functionality
- Admin review (approve/reject) of pending password-reset requests
  (`/api/admin/password-reset-requests/**`), admin-only knowledge-document management.

### Security controls
See [Section 15](#15-security-architecture) for the full list — service-to-service
authentication, PostgreSQL network isolation and least-privilege roles, rate limiting, a
nonce-based CSP, and defense-in-depth script validation are all implemented, not aspirational.

---

## 3. Technology Stack

Versions below are exactly as declared in `web-ui/package.json`, `ai-engine/requirements.txt`,
and the two Dockerfiles. Where a range (`^x.y.z`) is declared, the range is shown; do not assume
a specific patch version beyond what's pinned.

### Frontend (`web-ui`)

| Technology | Version | Notes |
|---|---|---|
| Next.js | `^16.2.4` | App Router. This version renames `middleware.ts` to `proxy.ts` — see `web-ui/proxy.ts`. |
| React | `19.2.4` | |
| TypeScript | `^5` | |
| Tailwind CSS | `^4` (via `@tailwindcss/postcss`) | |
| Prisma Client | `^6.7.0` | |
| jose | `^6.2.3` | JWT signing/verification (`HS256`). |
| zod | `^4.4.3` | Schema validation. |
| zustand | `^5.0.14` | Used by the Tool Wizard (`web-ui/store/toolWizardStore.ts`). |
| react-hook-form / @hookform/resolvers | `^7.81.0` / `^5.4.0` | |
| three / @react-three/fiber / @react-three/drei | `^0.184.0` / `^9.6.0` / `^10.7.7` | 3D viewport/toolpath rendering. |
| @monaco-editor/react | `^4.7.0` | Declared dependency; **not currently imported anywhere in source** (see [Section 22](#22-project-status--known-limitations)). |
| bcryptjs | `^3.0.3` | Password hashing. |
| pg | `^8.20.0` | Transitive Postgres driver used by Prisma; not imported directly. |
| radix-ui / @base-ui/react / lucide-react | various | UI primitives/icons. |

### Backend (`ai-engine`)

| Technology | Version | Notes |
|---|---|---|
| FastAPI | `0.136.1` | |
| Python | `3.12` | Pinned by `ai-engine/Dockerfile` (`FROM python:3.12-slim`). |
| uvicorn | `0.46.0` | ASGI server, run with `--workers 2` in the Docker image. |
| pydantic | `2.13.4` | v2, used throughout for request/response models. |
| google-genai | `2.0.0` | Official Google Gemini SDK — used by `GoogleGateway`, **not** by the CAD Prompt Assistant, which calls the Gemini REST API directly via `requests`. |
| requests | `2.33.1` | |
| psycopg2-binary | `2.9.9` | Direct PostgreSQL access for the knowledge-document repository. |
| pgvector | `0.3.2` | Declared dependency (vector-similarity support). |
| build123d | `0.10.0` | Parametric CAD kernel (wraps OpenCascade). |
| cadquery-ocp / cadquery-ocp-proxy | `7.8.1.1.post1` / `7.9.3.1` | OpenCascade bindings. |
| ezdxf | `1.4.3` | DXF export. |
| numpy / scipy / sympy | `2.4.4` / `1.17.1` / `1.14.0` | Geometry/numeric support. |
| pymupdf (`fitz`) | `>=1.24.9` | PDF/blueprint parsing. |
| pytest / pytest-cov / pytest-mock | `8.2.2` / `5.0.0` / `3.14.0` | |

### Database

| Technology | Notes |
|---|---|
| PostgreSQL | `postgres:16-alpine` (pinned in `docker-compose.yml`). |
| Prisma | Schema-driven migrations (`prisma db push`, not `prisma migrate`) — see [Section 10](#10-database-architecture). |

### AI / LLM

| Provider | Client | Notes |
|---|---|---|
| Google Gemini | `google-genai` SDK (`GoogleGateway`) and a direct REST call (`CADPromptAssistantService._call_gemini`) | Two independent call paths — see [Section 12](#12-ai--llm-pipeline). |
| OpenRouter | Direct REST calls via `requests` | Optional fallback; used when Gemini is unavailable/unconfigured. |

Current model configuration, verified against `ai-engine/app/services/agents/cad_prompt_assistant.py`,
`ai-engine/app/services/llm/gateways/google.py`, and `docker-compose.yml`:

- **CAD Prompt Assistant allowlist / default** (`ALLOWED_GEMINI_MODELS` / `DEFAULT_GEMINI_MODEL`):
  `gemini-3.5-flash-lite` (default), `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.7-flash`,
  `gemini-3.8-flash`. No Gemini 2.x model and no Gemini Pro model is permitted here.
- **`GoogleGateway` fallback chain** (`ai-engine/app/services/llm/gateways/google.py`):
  `[requested model, "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"]`.
- **`GENAI_MODEL` environment default**: `gemini-3.5-flash-lite` (`docker-compose.yml`, root
  `.env.example`, `ai-engine/app/api/v1/router.py`, `ai-engine/app/services/llm/llm_codegen.py`).
- `ai-engine/.env.example` documents `GENAI_MODEL=gemini-3.1-flash-preview` as an example —
  this is a **Gemini 3.x** model, not Gemini 2.x, but differs from the default above; it is an
  inconsistency in the example file, not a runtime default (see
  [Section 22](#22-project-status--known-limitations)).
- The broader `MODEL_REGISTRY` (`ai-engine/app/services/llm/registry.py`,
  `web-ui/lib/models-registry.ts`) is a **separate**, general-purpose chat-model catalog spanning
  Google, OpenRouter (DeepSeek, Anthropic, OpenAI), and Ollama entries, including one Gemini Pro
  entry (`gemini-3.1-pro`). It is not the CAD Prompt Assistant's allowlist — see
  [Section 12](#12-ai--llm-pipeline).

### CAD / Geometry

| Technology | Role |
|---|---|
| build123d | Parametric CAD scripting/execution kernel. |
| OpenCascade (via cadquery-ocp) | Underlying B-Rep geometry kernel. |
| ezdxf | DXF export. |

**Note:** `build123d`/`cadquery-ocp` were **not installable in the environment this README was
verified in** (their native OCP dependency requires Python `<3.14`); their presence and version
pins were confirmed from `requirements.txt`, not from a successful local import.

### Infrastructure

| Technology | Notes |
|---|---|
| Docker / Docker Compose | `docker-compose.yml` (base/production-oriented), `docker-compose.dev.yml` (host-tooling override). |
| Base images | `node:20-alpine` (web-ui build/runtime), `python:3.12-slim` (ai-engine), `postgres:16-alpine`. |

### Testing

| Tool | Project | Command |
|---|---|---|
| Jest `^30.4.2` (via `next/jest`) | web-ui | `npm test` / `npx jest` |
| pytest `8.2.2` | ai-engine | `pytest` (config: `ai-engine/pytest.ini`) |
| ESLint `^9` | web-ui | `npm run lint` |
| TypeScript compiler | web-ui | `npx tsc --noEmit` (no dedicated npm script exists for this) |

---

## 4. System Architecture

```
                                   ┌───────────────────────┐
                                   │        Browser         │
                                   └───────────┬────────────┘
                                               │  HTTPS (port 3000, only published port)
                                               ▼
                         ┌────────────────────────────────────────────┐
                         │                  web-ui                    │
                         │        Next.js 16 App Router + BFF         │
                         │  ─────────────────────────────────────     │
                         │  proxy.ts:  /workspace auth redirect,      │
                         │             per-request CSP nonce          │
                         │  app/api/**:  session/JWT auth, rate       │
                         │             limiting, ownership checks     │
                         └───────┬───────────────────────┬────────────┘
                                 │                        │
                 postgresql://vexcad_app:***@postgres     │  HTTP + X-Service-Key
                 (Prisma; least-privilege role)            │  (Docker-internal only)
                                 │                        ▼
                                 │            ┌─────────────────────────┐
                                 │            │        ai-engine         │
                                 │            │  FastAPI, no published   │
                                 │            │  host port                │
                                 │            │  ───────────────────      │
                                 │            │  every /api/v1/* route    │
                                 │            │  requires X-Service-Key   │
                                 │            │  (validate_service_key)   │
                                 │            └──┬─────────────┬─────────┘
                                 │               │             │
                                 ▼               ▼             ▼
                  ┌──────────────────┐  ┌──────────────┐  ┌─────────────────────┐
                  │    PostgreSQL     │  │ Google Gemini │  │ OpenRouter (optional │
                  │  (internal `db`   │  │  REST / SDK   │  │      fallback)        │
                  │  network only)    │  └──────────────┘  └─────────────────────┘
                  └──────────────────┘
                          ▲
                          │ postgresql://vexcad_admin:***@postgres (superuser)
                  ┌──────────────────┐
                  │      migrate      │  one-shot: roles → prisma db push → grants
                  │  (build target    │  (never runs as part of the app runtime)
                  │  of web-ui image) │
                  └──────────────────┘

   Shared Docker volume `cad_outputs` (/app/outputs) is mounted into BOTH
   web-ui and ai-engine — ai-engine writes generated artifacts, web-ui
   serves them back to the browser with per-session ownership checks
   (never serves the volume directly).
```

**Boundaries, verified from `docker-compose.yml` and source:**

- **Public boundary:** only `web-ui` publishes a host port (`3000:3000`). Neither `postgres` nor
  `ai-engine` has a `ports:` entry in the base `docker-compose.yml`.
- **Internal services:** `ai-engine` and `postgres` are reachable only from containers on the
  same Docker networks (`default` and/or the internal `db` network); there is no route to them
  from outside the Docker host through the base compose file.
- **Authentication boundary:** `web-ui` owns all end-user authentication (JWT cookie,
  `tokenVersion` checks). `ai-engine` does **not** authenticate end users at all — it trusts
  whichever caller presents a valid `X-Service-Key`, and relies entirely on `web-ui` to have
  already enforced user auth and resource ownership before it ever calls `ai-engine`.
- **Database boundary:** `web-ui` and `ai-engine` both connect to PostgreSQL directly (not
  through each other), using the same least-privilege `vexcad_app` role. Only `postgres` itself
  and the one-shot `migrate` service ever hold the `vexcad_admin` (superuser) credential.
- **AI service boundary:** `ai-engine` is the only service that calls out to Gemini/OpenRouter.
  `web-ui` never calls an LLM provider directly.
- **Service-to-service authentication:** every request `web-ui` sends to `ai-engine` goes
  through a single helper, `web-ui/lib/aiEngine.ts`'s `aiEngineFetch()`, which attaches
  `X-Service-Key` (from the server-only `SERVICE_API_KEY` env var) and strips any
  caller-supplied `X-Service-Key` header first. `ai-engine` enforces this on the FastAPI router
  itself (`app.include_router(v1_router, dependencies=[Depends(validate_service_key)])`), so
  every route under `/api/v1/*` is covered by construction, not per-route opt-in.
- **Output storage:** generated artifacts live on a named Docker volume (`cad_outputs`) mounted
  at `/app/outputs` in both `web-ui` and `ai-engine`. `ai-engine` writes; `web-ui` serves files
  back to authenticated, session-owning users through `app/api/outputs/[...path]/route.ts`.
- **Rendering flow:** see [Section 13](#13-cad-generation--rendering-pipeline).
- **Request flow:** see [Section 14](#14-api--service-communication).

---

## 5. Repository / Directory Structure

```
.
├── docker-compose.yml            # Base/production-oriented service definitions
├── docker-compose.dev.yml        # Dev override: loopback-only Postgres host port
├── .env.example                  # Root-level secrets consumed by docker-compose.yml
├── docs/                         # Supplementary design/architecture notes (not auto-generated)
│   ├── PROJECT.md
│   ├── TECHNICAL_DETAILS.md
│   ├── AI_ENGINE_OVERVIEW.md
│   ├── AI_PROMPTS.md
│   ├── LLM_CODEGEN_SERVICE.md
│   ├── PARAMETER_RENDER_SERVICE.md
│   └── PLAN.md
│
├── ai-engine/                    # FastAPI backend
│   ├── app/
│   │   ├── main.py               # FastAPI app, router mounting, service-key dependency
│   │   ├── deps.py                # X-Service-Key validation dependency
│   │   ├── api/v1/router.py       # All /api/v1/* route handlers
│   │   ├── models/                # Pydantic schemas + LLM model metadata (schemas.py, domain.py)
│   │   └── services/
│   │       ├── llm/               # Gemini/OpenRouter gateways, model registry, code generation,
│   │       │                      #   AST script validation (parameter_render.py)
│   │       ├── agents/            # CAD Prompt Assistant
│   │       ├── cam/, planning/, toolpath/, simulation/, tooling/, gcode/, validation/
│   │       │                      # CAM pipeline stages
│   │       ├── geometry/, extraction/, knowledge/, io/
│   │       └── cam_pipeline_manager.py
│   ├── tests/                     # pytest suite
│   ├── scripts/validate.py        # Local CLI for exercising codegen/audits
│   ├── docker-entrypoint.sh       # Drops root → caduser via runuser before starting uvicorn
│   ├── Dockerfile
│   ├── requirements.txt
│   └── .env.example
│
└── web-ui/                        # Next.js frontend + BFF
    ├── app/
    │   ├── page.tsx, layout.tsx    # Landing page, root layout
    │   ├── workspace/               # Main CAD/CAM workspace UI
    │   ├── login/, register/, forgot-password/, admin/
    │   ├── tools/, holders/, import-export/, share/[id]/
    │   └── api/                     # BFF route handlers — see Section 14
    │       ├── auth/, admin/, sessions/, cam/, assistant/, knowledge/,
    │       │   blueprint/, outputs/, tools/, holders/, export/, generate/, render/
    ├── components/                  # workspace/, cam/, tools/, viewport/, chat/, assistant/,
    │                                #   auth/, admin, landing/, shared/, ui/ (design-system primitives)
    ├── lib/                         # auth.ts, aiEngine.ts, rateLimit.ts, prisma.ts,
    │                                #   outputsDir.ts, models-registry.ts, cam/, db/, validation/
    ├── store/                       # zustand store (Tool Wizard)
    ├── prisma/schema.prisma         # Full data model — see Section 10
    ├── scripts/                     # db-bootstrap.js (role/grant bootstrap),
    │                                #   export_and_restore_sessions.js, and ad-hoc tool-library
    │                                #   import/maintenance scripts
    ├── __tests__/                   # Jest suite
    ├── proxy.ts                     # Next.js 16 "Proxy" (formerly middleware.ts):
    │                                #   /workspace auth redirect + per-request CSP nonce
    ├── next.config.ts
    ├── Dockerfile
    └── .env.example
```

Not shown above (present but not part of the documented architecture): compiled build output
(`.next/`), `node_modules/`, Python `__pycache__`/virtualenv directories, and per-developer local
files (`.env`, log files) — all covered by `.gitignore`/`.dockerignore`.

---

## 6. Requirements

### Required for Docker

- Docker with Compose v2 (the `docker compose` subcommand; verified against Docker Engine
  `29.8.1` / Compose `v5.5.1` during this review — **older versions were not tested**).
- No documented minimum RAM/storage in this repository; `ai-engine`'s image includes a full
  C/C++ build toolchain and the `build123d`/OpenCascade stack, so expect a non-trivial image
  build (exact size **not measured/documented** here).

### Required for web-ui local development

- Node.js — `web-ui/Dockerfile` uses `node:20-alpine`; use a matching Node 20.x locally.
- npm (the repository ships `package-lock.json`; no `pnpm-lock.yaml`/`yarn.lock` is present).
- A reachable PostgreSQL instance with the schema applied (see [Section 10](#10-database-architecture)).
- Prisma Client generation (`npm run prisma:generate`) before first run.

### Required for ai-engine local development

- Python — `ai-engine/Dockerfile` pins `python:3.12-slim`. Use a matching 3.12.x interpreter;
  earlier versions are **not verified** against the current dependency pins.
- pip (no `poetry`/`pipenv`/`uv` lockfile is present — only `requirements.txt`).
- System packages the Docker image installs before `pip install`: `build-essential`, `libgl1`,
  `libglib2.0-0`, `libxrender1`, `libxext6`, `libgomp1`, `curl` (from `ai-engine/Dockerfile`).
  Reproduce these on the host if installing `build123d`/`cadquery-ocp` outside Docker.
- No CUDA/GPU requirement is declared anywhere in the repository; CPU-only operation is the only
  configuration this repository supports.

### External services

| Service | Required? | Purpose |
|---|---|---|
| Google Gemini API key (`GOOGLE_API_KEY`) | **Optional at the config level**, but AI generation and the CAD Prompt Assistant's primary path will not function without it. `docker-compose.yml` has no `:?` guard on this variable, so the stack starts without it. | Primary CAD-generation and prompt-assistant model. |
| OpenRouter API key (`OPENROUTER_API_KEY`) | Optional | Fallback used by the CAD Prompt Assistant when Gemini is unavailable/unconfigured. |

### Summary

| Item | Status |
|---|---|
| Docker + Compose | Required for the documented full-stack workflow |
| Node.js 20.x, npm | Required for `web-ui` (Docker or host) |
| Python 3.12.x, pip | Required for `ai-engine` (Docker or host) |
| PostgreSQL | Required (Docker-provided or external) |
| `GOOGLE_API_KEY` | Required for AI features to function; not required to start the stack |
| `OPENROUTER_API_KEY` | Optional |
| `docker-compose.dev.yml` | Development-only |

---

## 7. Environment Variables

Values below reflect the current `.env.example` files and `docker-compose.yml`. **Never commit a
real `.env` file** — all three `.env.example` files ship with blank/placeholder secrets, and
`docker-compose.yml` refuses to start without the required ones set.

### Root `.env.example` (consumed by `docker-compose.yml`)

| Variable | Required? | Used By | Default | Purpose | Sensitive? |
|---|---|---|---|---|---|
| `GOOGLE_API_KEY` | No (see [Section 6](#6-requirements)) | ai-engine | *(none)* | Gemini API key | **Yes** |
| `GENAI_MODEL` | No | ai-engine | `gemini-3.5-flash-lite` | Default model for `/generate`/`/render` codegen paths | No |
| `GENAI_MAX_RETRIES` | No | ai-engine | `5` | LLM call retry count | No |
| `GENAI_RETRY_BASE_DELAY` | No | ai-engine | `1.5` | Retry backoff base (seconds) | No |
| `GENAI_MAX_RETRY_DELAY` | No | ai-engine | `75` | Retry backoff cap (seconds) | No |
| `OPENROUTER_API_KEY` | No | ai-engine | *(empty)* | Optional OpenRouter fallback for the CAD Prompt Assistant | **Yes** |
| `JWT_SECRET` | **Yes** (`:?` guard in web-ui) | web-ui | *(none — must be set)* | Signs/verifies session JWTs | **Yes** |
| `SERVICE_API_KEY` | **Yes** (`:?` guard, both services) | web-ui, ai-engine | *(none — must be set)* | Shared `X-Service-Key` for BFF→ai-engine calls | **Yes** |
| `POSTGRES_ADMIN_PASSWORD` | **Yes** (`:?` guard) | postgres, migrate | *(none — must be set)* | Superuser/bootstrap credential | **Yes** |
| `POSTGRES_APP_PASSWORD` | **Yes** (`:?` guard) | web-ui, ai-engine, migrate | *(none — must be set)*, min. 16 chars enforced by `db-bootstrap.js` | Least-privilege application-role credential | **Yes** |
| `POSTGRES_DB` | No | postgres, migrate, web-ui, ai-engine | `cad_db` | Database name | No |
| `POSTGRES_ADMIN_USER` | No | postgres, migrate | `vexcad_admin` | Admin role name | No |
| `POSTGRES_APP_USER` | No | web-ui, ai-engine, migrate | `vexcad_app` | Application role name | No |
| `POSTGRES_HOST_PORT` | No | postgres (via `docker-compose.dev.yml` only) | `5433` | Host-side loopback port for the dev DB override | No |
| `TRUST_PROXY_HEADERS` | No | web-ui | `false` | Whether to trust `X-Forwarded-For` for per-IP rate limiting — only safe behind a reverse proxy that is the sole path to web-ui | No |

### `web-ui/.env.example` (host-side development only — **not** read by `docker-compose.yml`)

| Variable | Required? | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes (host dev) | Application-role Postgres connection string |
| `DIRECT_URL` | Yes (host dev, for `npm run prisma:push`) | Must be the **admin** role — the application role cannot run DDL |
| `SERVICE_API_KEY` | Yes | Must equal ai-engine's value |
| `JWT_SECRET` | Yes | See above |
| `FASTAPI_URL` | Yes | Base URL the BFF calls, e.g. `http://127.0.0.1:8000/api/v1` |
| `NEXT_PUBLIC_FASTAPI_URL` | Yes | Client-side equivalent, used for direct browser fetches of model/artifact URLs |

### `ai-engine/.env.example` (host-side development only — **not** read by `docker-compose.yml`)

| Variable | Required? | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes (host dev; requires `docker-compose.dev.yml` for a reachable Postgres) | Application-role Postgres connection string |
| `SERVICE_API_KEY` | Yes — ai-engine returns `503` on every `/api/v1/*` route while this is unset/blank | Must equal web-ui's value |
| `GOOGLE_API_KEY` | See above | |
| `GENAI_MODEL` | No | Example value in this file (`gemini-3.1-flash-preview`) differs from the `docker-compose.yml`/root-`.env.example` default (`gemini-3.5-flash-lite`) — both are Gemini 3.x, but this is a documentation inconsistency, not a runtime default; see [Section 22](#22-project-status--known-limitations). |
| `GENAI_MAX_RETRIES` / `GENAI_RETRY_BASE_DELAY` / `GENAI_MAX_RETRY_DELAY` | No | Same as root file |
| `OPENROUTER_API_KEY` | No | |

### Docker-specific propagation notes

- `docker-compose.yml` does **not** use `env_file:` for any service — it reads the root `.env`
  (Compose's own automatic project-directory `.env` loading) purely to substitute `${VAR}`
  references inside the compose file itself. The per-service `.env.example` files in `web-ui/`
  and `ai-engine/` are for running those services **directly on the host**, outside Docker.
- Every `${VAR:?message}` entry causes `docker compose` to refuse to start (non-zero exit, named
  error) if that variable is unset **or empty** — verified with `docker compose config`.
- `OPENROUTER_API_KEY` is wired only into `ai-engine`'s environment block, not `web-ui`'s or
  `migrate`'s.

---

## 8. Docker Setup

### Services (from `docker-compose.yml`)

#### `postgres`
- **Purpose:** primary datastore.
- **Image:** `postgres:16-alpine` (no custom build).
- **Ports:** none published to the host in the base file.
- **Networks:** `db` only.
- **Volumes:** `cad_postgres_data:/var/lib/postgresql/data`.
- **Dependencies:** none (it's the root of the dependency graph).
- **Healthcheck:** `pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"`, every 10s, 5 retries.
- **Environment:** `POSTGRES_DB`, `POSTGRES_USER` (defaults to the **admin** role name), and the
  required `POSTGRES_PASSWORD` (admin password). This container never receives the application
  role's credentials.

#### `migrate`
- **Purpose:** one-shot database bootstrap — creates/updates the least-privilege application
  role, applies the Prisma schema (`prisma db push --skip-generate`), then grants that role
  DML-only access. Also creates one database object Prisma's schema language cannot express: a
  partial unique index enforcing "at most one pending `PasswordResetRequest` per user" (see
  [Section 10](#10-database-architecture)).
- **Build:** `./web-ui` context, `Dockerfile`, target `migrate` (a dedicated Dockerfile stage —
  it is **not** part of the runtime `web-ui` image).
- **Ports:** none.
- **Networks:** `db` only.
- **Volumes:** none.
- **Dependencies:** `postgres` (`condition: service_healthy`).
- **Healthcheck:** none (it's a one-shot job, not a long-running service).
- **Environment:** the **admin** `DATABASE_URL`/`DIRECT_URL` (needed to bootstrap roles/schema),
  plus `POSTGRES_APP_USER`/`POSTGRES_APP_PASSWORD` (the credential it *creates*, not the one it
  connects as). `restart: "no"`.
- **Container naming:** deliberately has no `container_name:` — a fixed name on a one-shot
  service would outlive the container (`Exited`, not removed) and collide with a second run of
  the stack on the same host.

#### `ai-engine`
- **Purpose:** FastAPI service running LLM-driven CAD generation, script validation/execution,
  and the CAM pipeline.
- **Build:** `./ai-engine` context, `Dockerfile` (single stage).
- **Ports:** none published to the host — internal only.
- **Internal port:** `8000` (uvicorn; not published via `EXPOSE`+`ports:`, only reachable inside
  the Docker networks it joins).
- **Networks:** `default` and `db`.
- **Volumes:** `cad_outputs:/app/outputs`.
- **Dependencies:** `postgres` (`service_healthy`) and `migrate` (`service_completed_successfully`).
- **Healthcheck:** `curl -f http://localhost:8000/health`, every 30s, 3 retries, 20s start period.
  This checks that the process is up; it does **not** verify database connectivity, so a
  "healthy" ai-engine is not itself a guarantee that DB-backed features (e.g. knowledge-document
  endpoints) are ready — those connect lazily, per request.
- **Environment:** `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, `GENAI_MODEL`/retry tuning, the
  application-role `DATABASE_URL`, and the required `SERVICE_API_KEY`.
- **DNS:** explicitly set to `8.8.8.8`/`1.1.1.1` — needed for outbound calls to
  `generativelanguage.googleapis.com`/`openrouter.ai`.

#### `web-ui`
- **Purpose:** the Next.js application and BFF — the only public-facing service.
- **Build:** `./web-ui` context, `Dockerfile`, default (final) target — the multi-stage
  `runner` stage, which does **not** include the Prisma CLI or devDependencies.
- **Ports:** `3000:3000` — the only host-published port in the entire stack.
- **Networks:** `default` and `db`.
- **Volumes:** `cad_outputs:/app/outputs` (read path only — `web-ui` serves files from here, it
  does not write to it).
- **Dependencies:** `postgres` (`service_healthy`), `migrate` (`service_completed_successfully`),
  `ai-engine` (`service_healthy`).
- **Healthcheck:** none defined.
- **Environment:** `FASTAPI_URL` (points at the `ai-engine` service DNS name), the
  application-role `DATABASE_URL`/`DIRECT_URL`, the required `JWT_SECRET` and `SERVICE_API_KEY`,
  `TRUST_PROXY_HEADERS`, `NODE_ENV=production`.

### Docker network architecture

- **`default`** network: auto-created by Compose (not declared explicitly), joined by `web-ui`
  and `ai-engine`. Has normal outbound internet access (needed for ai-engine's LLM calls).
- **`db`** network: explicitly declared with `internal: true` — no route to the outside world.
  Joined by `postgres`, `migrate`, `web-ui`, and `ai-engine`. This is the only network `postgres`
  is on.
- **Why PostgreSQL is not published:** it has no `ports:` entry at all in the base file and sits
  only on the internal `db` network — there is no path from the host (or beyond) to it through
  the base configuration.
- **Development-only DB exposure:** `docker-compose.dev.yml` (see below) adds a loopback-only
  host port.
- **Service DNS names:** containers reach each other by **Compose service name**
  (`postgres`, `ai-engine`), resolved via Docker's embedded DNS — e.g. `web-ui`'s
  `FASTAPI_URL: http://ai-engine:8000/api/v1` and every `DATABASE_URL`'s `@postgres:5432`. As of
  the current `docker-compose.yml`, **no service has a hardcoded `container_name:`** — all
  container names are Compose-project-scoped, which is what lets two independent Compose
  projects (e.g. two developers, or a staging instance next to this one) run simultaneously on
  the same Docker host without a name collision.

### Persistent volumes

| Volume | Mounted at | Written by | Survives `docker compose down`? | Survives `down -v`? |
|---|---|---|---|---|
| `cad_postgres_data` | `/var/lib/postgresql/data` (postgres only) | postgres | Yes | **No — destroyed** |
| `cad_outputs` | `/app/outputs` (ai-engine, web-ui) | ai-engine | Yes | **No — destroyed** |

Both are named volumes declared at the bottom of `docker-compose.yml` with no `driver_opts` (no
host bind-mount path) — they're managed entirely by Docker, not tied to a specific host
directory. `docker compose down` (without `-v`) removes containers and the project's networks
but leaves both volumes intact; only `-v` removes them.

### Build process

- **`web-ui/Dockerfile`** — multi-stage:
  1. `deps`: `node:20-alpine`, `npm ci`.
  2. `builder`: copies `deps`'s `node_modules` + full source, sets placeholder
     `DATABASE_URL`/`DIRECT_URL`/`JWT_SECRET` values (needed only so `prisma generate` and
     `next build` succeed at build time — these placeholders never reach the runtime image and
     are not real credentials), runs `npx prisma generate` and `npm run build`.
  3. `migrate` (built `FROM deps`, not `FROM builder`): adds `prisma/` and
     `scripts/db-bootstrap.js`, runs as `USER node`. This is the image the `migrate` Compose
     service actually runs — it carries the Prisma CLI, which the runtime image deliberately
     does not.
  4. `runner` (the default/final stage, `FROM node:20-alpine`): copies only `public/`,
     `.next/standalone`, `.next/static`, and the generated Prisma client from `builder`. Runs as
     a dedicated non-root user (`nextjs`, uid 1001). `CMD ["node", "server.js"]`.
- **`ai-engine/Dockerfile`** — single stage (`FROM python:3.12-slim`): installs system packages,
  creates a non-root `caduser`, installs `requirements.txt`, copies the full source. The
  `ENTRYPOINT` (`docker-entrypoint.sh`) runs as root only long enough to `chown` the mounted
  outputs volume, then execs `runuser -u caduser -- uvicorn ...` — the actual application
  process runs unprivileged.

### Startup order

The actual dependency graph, as resolved by `docker compose config`:

```
postgres (healthy)
    │
    ├──► migrate (must complete successfully)
    │        │
    │        ▼
    ├──► ai-engine (waits for postgres healthy AND migrate completed) ──► (healthy)
    │                                                                        │
    └───────────────────────────────────────────────────────────────────────┤
                                                                              ▼
                                                                          web-ui
                                                        (waits for postgres healthy,
                                                         migrate completed, AND
                                                         ai-engine healthy)
```

### Docker commands

```bash
# Clone
git clone <repository-url> V-XCAD && cd V-XCAD

# Configure environment (fill in real secrets afterward — see Section 7)
cp .env.example .env

# Build all images
docker compose build

# Start the full stack (builds if needed)
docker compose up -d --build

# Stop (containers + project network; volumes are preserved)
docker compose down

# ⚠️ Stop AND permanently delete PostgreSQL data + generated outputs
docker compose down -v

# Restart everything
docker compose restart

# Restart a single service
docker compose restart web-ui

# View logs (all services, follow)
docker compose logs -f

# View logs for one service
docker compose logs -f ai-engine

# Inspect status
docker compose ps

# Rebuild and recreate a single service without touching the others
docker compose up -d --build ai-engine

# Re-run the database bootstrap/migration on its own (e.g. after editing prisma/schema.prisma)
docker compose run --rm migrate
```

### Development Compose override (`docker-compose.dev.yml`)

This file changes **exactly one thing**: it adds a host-published port to the `postgres`
service, bound to loopback only, plus the `default` network so Docker can publish that port at
all (an `internal: true` network cannot have a published port):

```yaml
services:
  postgres:
    networks:
      - db
      - default
    ports:
      - "127.0.0.1:${POSTGRES_HOST_PORT:-5433}:5432"
```

Usage — it is applied **in addition to** the base file, never alone:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
```

This exists so host-side tooling (`npm run prisma:push`, `npm run dev` on the host, `psql`,
`web-ui/scripts/*`) can reach PostgreSQL without publishing it to anything but `127.0.0.1` on the
Docker host itself — it is never bound to `0.0.0.0`/`[::]`, so no other machine on the network
can reach it. **This override is explicitly documentation-labeled "NOT for production"** inside
the file itself, and this README makes no claim about production behavior from it.

---

## 9. Local Development Without Docker

### PostgreSQL setup

You need a reachable PostgreSQL 16-compatible server with the schema applied and both roles
provisioned. The straightforward path is to run **only** Postgres via Docker (loopback-exposed)
and everything else on the host:

```bash
cp .env.example .env   # set POSTGRES_ADMIN_PASSWORD, POSTGRES_APP_PASSWORD, etc.
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm migrate
```

After this, PostgreSQL is reachable at `127.0.0.1:5433` (or `${POSTGRES_HOST_PORT}`), with the
`vexcad_app`/`vexcad_admin` roles provisioned as documented in
[Section 10](#10-database-architecture). Running a fully external (non-Docker) PostgreSQL is not
documented anywhere in this repository — **unverified** whether the bootstrap scripts assume
anything Docker-specific beyond connectivity.

### web-ui

```bash
cd web-ui
cp .env.example .env          # Windows: Copy-Item .env.example .env
npm install
npm run prisma:generate
npm run dev
```

- **Expected port:** `3000` (Next.js default; `npm run dev` does not override it).
- **Database initialization:** handled by the `migrate` step above, not by `web-ui` itself. If
  you instead run `npx prisma db push` directly from the host, `DIRECT_URL` in `web-ui/.env`
  must be the **admin** role connection string — the application role cannot run DDL by design.

### ai-engine

```bash
cd ai-engine
cp .env.example .env          # Windows: Copy-Item .env.example .env
python -m venv .venv
# Windows:  .venv\Scripts\Activate.ps1
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- **Expected port:** `8000`.
- **Required system dependencies:** see [Section 6](#6-requirements) — installing
  `build123d`/`cadquery-ocp` outside Docker requires the same native libraries the Dockerfile
  installs (`libgl1`, `libglib2.0-0`, `libxrender1`, `libxext6`, `libgomp1`) plus a C/C++
  toolchain.
- Every `/api/v1/*` route requires the `X-Service-Key` header — set `SERVICE_API_KEY` in
  `ai-engine/.env` and the identical value in `web-ui/.env`.
- Health check (the only unauthenticated route): `curl http://127.0.0.1:8000/health`.

### Running both services together

`web-ui` reaches `ai-engine` through the `FASTAPI_URL` environment variable — in host-side
development this is `FASTAPI_URL=http://127.0.0.1:8000/api/v1` (from `web-ui/.env.example`; the
client-side equivalent is `NEXT_PUBLIC_FASTAPI_URL`, same value). In Docker, this is instead
`http://ai-engine:8000/api/v1` (the Compose service DNS name — set directly in
`docker-compose.yml`, not something you configure yourself). Both services must agree on
`SERVICE_API_KEY`; there is no other coupling between them at startup.

---

## 10. Database Architecture

### Roles and credentials

| Role | Default name | Privilege level | Held by | Purpose |
|---|---|---|---|---|
| Admin/bootstrap | `vexcad_admin` | Cluster **superuser** (the official `postgres` image makes `POSTGRES_USER` one) | `postgres` container itself, and `migrate` | Creates/updates the application role, applies the Prisma schema (DDL), grants privileges |
| Application | `vexcad_app` | `LOGIN`, explicitly `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`; `SELECT/INSERT/UPDATE/DELETE` on tables only, no DDL, no `TRUNCATE` | `web-ui`, `ai-engine` | Normal runtime queries |

`web-ui`/`ai-engine` **never** receive the admin credential — verified directly in each
service's `environment:` block in `docker-compose.yml`.

### Bootstrap process (`web-ui/scripts/db-bootstrap.js`)

Run by the `migrate` Compose service, in two phases, both idempotent:

1. **`roles`** (before `prisma db push`): creates the application role if absent, or rotates its
   password with `ALTER ROLE` if it already exists (never re-creates it), with the restrictive
   attributes above; revokes `PUBLIC`'s default `CONNECT` on this database and on the
   `postgres`/`template1` maintenance databases.
2. **`grants`** (after `prisma db push`): grants `SELECT/INSERT/UPDATE/DELETE` on all current
   *and future* tables/sequences to the application role, explicitly revokes `TRUNCATE`,
   `REFERENCES`, `TRIGGER`; and creates one database object outside Prisma's own schema-push
   mechanism — a **partial unique index** on `PasswordResetRequest("userId") WHERE status =
   'pending'**. Prisma's schema language has no syntax for filtered/partial indexes, so this is
   applied here rather than in `prisma/schema.prisma`; it survives every future `prisma db push`
   because Compose's own migration only manages objects it explicitly declares.

Input to the bootstrap script is validated before any database connection is opened (role-name
format, minimum 16-character application password, the app role must differ from the admin
role) — see `web-ui/scripts/db-bootstrap.js`.

### Migrations/schema

Schema changes are applied with **`prisma db push`**, not `prisma migrate` — there is no
`prisma/migrations/` directory in this repository. `prisma db push` reconciles the live database
to match `prisma/schema.prisma` directly and refuses destructive changes unless explicitly
forced. Prisma-managed and hand-managed (the partial index above) database objects coexist
without conflict, verified empirically: `prisma db push` does not touch objects it doesn't
declare.

### Data model (`web-ui/prisma/schema.prisma`)

Grouped by area (not exhaustive field lists — see the schema file for full detail):

- **Sessions/generation:** `CadSession`, `CadIteration`.
- **Users/auth:** `User` (includes `tokenVersion`, `isAdmin`), `PasswordResetRequest` (has the
  partial-unique-pending-index invariant above, plus regular `@@index`es on `status`, `userId`,
  `expiresAt`).
- **CAM pipeline:** `CamSetup`, `CamTool`, `CamOperation`, `ToolpathSegment`, `SimulationRun`,
  `SimulationEvent`, `CostEstimate`, `WorkpieceMaterial`, `MachineProfile`.
- **Tool library (CAM-oriented):** `ToolMaterial`, `ToolCoating`, `ToolHolder`,
  `ToolDefinition`, `CuttingData`.
- **Tool library (Tool Wizard-oriented, a separate model set):** `Tool`, `ToolGeometry`,
  `ToolOffset`, `Holder`, `ToolAssembly`, `ToolCuttingData`, `ToolCompatibility`. This repository
  currently has **two independent tool-data model families** — see
  [Section 22](#22-project-status--known-limitations).
- **Knowledge base:** `KnowledgeDocument`, `OntologyNode`, `EngineeringRule`.
- **Abuse control:** `RateLimitBucket` (one row per rate-limit rule × identity, atomic
  upsert-based).

### Development DB access

Only via `docker-compose.dev.yml`'s loopback-only port (see [Section 8](#8-docker-setup)), or by
running Postgres entirely outside this repository's Docker setup (unverified/unsupported by any
script here).

### Relevant commands

```bash
npm run prisma:generate     # regenerate the Prisma Client (web-ui)
npm run prisma:push         # push schema.prisma to the DB — requires the ADMIN DIRECT_URL
node scripts/db-bootstrap.js roles    # (inside web-ui, admin DATABASE_URL) — create/rotate the app role
node scripts/db-bootstrap.js grants   # (inside web-ui, admin DATABASE_URL) — apply DML grants + the partial index
```

---

## 11. Authentication and Authorization

### Sessions and tokens

- Sessions are JSON Web Tokens (`jose`, `HS256`), stored in an `auth_token` cookie, signed with
  `JWT_SECRET` (`web-ui/lib/auth.ts`).
- Two resolution functions exist, and using the wrong one for the wrong purpose is a real
  security distinction in this codebase:
  - **`getUnverifiedSession()`** — verifies only the JWT signature/expiry. Does **not** touch
    the database. Used in exactly one place in the current source (the landing page's
    "Sign in" vs. "Open Workspace" button label) — never for authorization decisions.
  - **`getSession()` / `requireSession()` / `requireAdmin()`** — the authoritative path. Verifies
    the signature, then checks the database: the user must still exist, and the token's
    `tokenVersion` claim must equal the user's *current* `tokenVersion`. Fails closed (returns
    `null`/401) on any mismatch, missing user, or database error.

### `tokenVersion` invalidation

`User.tokenVersion` is an integer, incremented whenever a password-reset request is **approved**
by an admin (in the same database transaction as the password update). Every JWT embeds the
`tokenVersion` that was current when it was issued, so approving a reset immediately invalidates
every previously-issued session for that user — without needing a server-side session/token
blocklist.

### Password reset workflow

There is **no self-service email-link reset** in this repository. The flow is admin-mediated:

1. `POST /api/auth/forgot-password` — the user submits a new password directly. The response is
   identical whether or not the account exists (`VEX-2A-011`, prevents account enumeration), and
   password hashing happens *before* the account lookup so existing/non-existing emails cost the
   same (no timing oracle). This creates (or updates, if one is already pending) a
   `PasswordResetRequest` row with `status: "pending"` and the new password's hash — the password
   is **not** applied yet.
2. An admin reviews pending requests (`GET /api/admin/password-reset-requests`) and either:
   - **Approves** (`POST .../[id]/approve`) — atomically transitions the request to `approved`,
     applies the new password hash to the `User` row, and increments `tokenVersion`.
   - **Rejects** (`POST .../[id]/reject`), optionally with a reason.
3. A user can have unlimited historical approved/rejected requests, but only **one pending
   request at a time** — enforced at the database level by the partial unique index described in
   [Section 10](#10-database-architecture), not merely by application logic (verified: a genuine
   concurrent-insert race was tested and exactly one of two simultaneous pending inserts
   succeeds).

### Admin authorization

`requireAdmin()` layers on top of `requireSession()`: it additionally requires `User.isAdmin =
true` in the database. Used to gate the password-reset review endpoints and the knowledge-base
management endpoints.

### Service-to-service authentication

Covered in [Section 4](#4-system-architecture)/[15](#15-security-architecture): `X-Service-Key`,
enforced router-wide on `ai-engine`, attached exclusively by `web-ui/lib/aiEngine.ts`.

### Protected APIs / workspace authentication

- `web-ui/proxy.ts` (the Next.js 16 "Proxy" file — this version renamed `middleware.ts`)
  redirects unauthenticated requests to `/workspace` to `/login`, checking the JWT via
  `verifyToken()`. This runs before the CSP-nonce logic in the same function; the CSP logic
  never bypasses or weakens this check.
- Every BFF API route that touches user data independently calls `getSession()`/
  `requireSession()`/`requireAdmin()` itself — the proxy-level redirect is a UX convenience for
  page navigation, not the sole enforcement point.

### Rate limiting relevant to auth

See [Section 16](#16-rate-limiting) — login uses a capped exponential backoff per account (not a
flat lockout window), specifically to prevent an anonymous caller from locking out a legitimate
account (including the admin account) by making a handful of failed guesses.

---

## 12. AI / LLM Pipeline

There are **two independent Gemini call paths** in this repository — they are not the same code
and do not share configuration beyond both reading `GOOGLE_API_KEY`:

### Path 1 — CAD generation (`llm_codegen.py`, via `GoogleGateway`)

1. A user request reaches `ai-engine`'s `/generate` or `/render` routes.
2. The model to use is resolved from `MODEL_REGISTRY` (`ai-engine/app/services/llm/registry.py`)
   — a general catalog spanning Google, OpenRouter (DeepSeek, Anthropic, OpenAI), and Ollama
   entries — defaulting to `GENAI_MODEL` (env, default `gemini-3.5-flash-lite`) when nothing is
   selected.
3. `GoogleGateway.generate()`/`generate_stream()` (using the official `google-genai` SDK) tries a
   **fixed 5-level fallback chain**: `[the requested model, "gemini-3.5-flash-lite",
   "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"]`, advancing to the next candidate
   only on `503`/`"unavailable"`/`"high demand"`/`404`/`"not found"` errors (any other error
   propagates immediately, it does not silently fall through).
4. Streaming is implemented (`generate_stream`, an async generator yielding text chunks) as well
   as non-streaming (`generate`).
5. Retries/backoff for this path are governed by `GENAI_MAX_RETRIES`/`GENAI_RETRY_BASE_DELAY`/
   `GENAI_MAX_RETRY_DELAY` at the call-site level (`llm_codegen.py`), independent of the
   in-gateway model-fallback loop above.

### Path 2 — CAD Prompt Assistant (`cad_prompt_assistant.py`, direct REST calls)

Used by the blueprint-vs-render comparison feature (`/assistant/compare-and-prompt`). This path
does **not** use the `google-genai` SDK — it calls the Gemini REST endpoint directly via
`requests`, and separately supports OpenRouter as a REST fallback.

1. `model = model_override or DEFAULT_GEMINI_MODEL` (`DEFAULT_GEMINI_MODEL =
   "gemini-3.5-flash-lite"`). `model_override` is caller-supplied
   (`CADPromptAssistantRequest.model`), but in the current UI, `PromptAssistantWidget.tsx` never
   populates it — the default is what's actually used in practice today.
2. Before the model reaches the Gemini REST URL, it is checked against an **explicit allowlist**,
   `ALLOWED_GEMINI_MODELS = {"gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash",
   "gemini-3.7-flash", "gemini-3.8-flash"}` — any other value (including any Gemini 2.x model
   name, or a non-Gemini model id) falls back to `DEFAULT_GEMINI_MODEL`. This is a genuine
   allowlist, not a loose prefix check, specifically so a caller cannot request a retired model
   by name.
3. If the Gemini call fails or `GOOGLE_API_KEY` isn't set, it falls back to OpenRouter
   (`google/gemini-3.5-flash`) if `OPENROUTER_API_KEY` is configured.
4. If neither succeeds, the response is a documented, non-crashing error payload:
   `{"error": "api_error", ...}`.

### Model selection UI vs. CAD Prompt Assistant allowlist

`web-ui/lib/models-registry.ts` / `ai-engine/app/services/llm/registry.py` present a broader,
multi-vendor model picker (used for CAD generation, Path 1) including one Gemini Pro entry
(`gemini-3.1-pro`). **This catalog is unrelated to the CAD Prompt Assistant's allowlist** in Path
2 — V-XCAD does not expose Gemini Pro, or any Gemini 2.x model, anywhere in the CAD Prompt
Assistant's reachable configuration, regardless of what the general registry contains.

### Service authentication for this pipeline

Both paths run inside `ai-engine`, reachable from `web-ui` only via `aiEngineFetch()` +
`X-Service-Key` — see [Section 4](#4-system-architecture).

### AI model fallback flow (Path 1, `GoogleGateway`)

```
requested model
     │  (503 / unavailable / high demand / 404 / not found)
     ▼
gemini-3.5-flash-lite
     │  (same conditions)
     ▼
gemini-3.8-flash
     │  (same conditions)
     ▼
gemini-3.7-flash
     │  (same conditions)
     ▼
gemini-3.6-flash
     │  (exhausted)
     ▼
raise the last error
```

Any other exception class (not in the retryable list above) is raised immediately at whichever
candidate produced it — the chain does not swallow unrelated errors.

---

## 13. CAD Generation / Rendering Pipeline

```
 user prompt (+ optional image)
        │
        ▼
 AI generation (ai-engine/app/services/llm/llm_codegen.py, via GoogleGateway)
        │  produces a parametric build123d Python script
        ▼
 validate_script_syntax()          — ast.parse(); rejects on SyntaxError
        │
        ▼
 validate_script_security()        — AST-based static allowlist/denylist check:
        │                             ALLOWED_MODULES = {build123d, math, re, ocp_vscode,
        │                             typing, bd_warehouse}; blocks dunder attributes,
        │                             os/sys/subprocess-adjacent names, eval/exec/__import__,
        │                             and (as of the current hardening pass) the os.spawn*
        │                             family by prefix match, not just exact string match.
        │                             Also fails closed if ast.parse() itself raises
        │                             SyntaxError here (returns False, not True).
        ▼
 script execution — a subprocess run as the non-root `caduser` user (dropped via
        │             `runuser` in docker-entrypoint.sh), with a curated/restricted
        │             builtins dict (no eval/exec/open/__import__) and a curated
        │             environment (application secrets such as API keys and the
        │             database URL are NOT forwarded into this subprocess)
        ▼
 build123d/OpenCascade executes the script → STL / STEP / DXF geometry
        │
        ▼
 output storage — written to the shared runtime output directory
        │           (`/app/outputs`, the `cad_outputs` Docker volume)
        ▼
 web-ui retrieval — `GET /api/outputs/[...path]`: requires an authenticated session,
                     resolves the owning CadSession from the filename, and denies
                     access unless the caller owns that session (or it's shared)
```

**On the sandbox boundary — do not overstate it.** `validate_script_security()`'s own docstring
in `ai-engine/app/services/llm/parameter_render.py` is explicit about this: it is documented as
**defense-in-depth**, not a complete security boundary — "AST filtering cannot reliably sandbox
Python; attribute-based re-exports through allowed modules can bypass static analysis." The
properties that actually hold, verified independently against the current implementation:

- The restricted-execution subprocess process never receives application secrets (API keys,
  database credentials, JWT secret) — verified directly against the environment-building code.
- The subprocess runs as a dedicated non-root Linux user, not root.
- A previously-claimed concrete AST-bypass chain (walking generator frame objects to reach a
  trusted module's globals) was empirically tested against the real implementation and does
  **not** work in the current build: `f_back` is `None` for every externally-observable
  generator state in this Python runtime, so that specific attack chain does not reach a usable
  `os` reference. This was verified by execution, not by re-reading the code.
- Separately, `os` and the `spawn*`/`posix_spawn*` family of process-execution functions were
  added to the AST denylist as defense-in-depth, closing a class of attribute-chain bypass
  (`some_allowed_module.os.spawnv(...)`) even though the concrete exploit path for it in the
  current runtime wiring (the restricted builtins omit `__import__`, so user scripts cannot
  actually import an arbitrary module to chain off of) was not demonstrated to be reachable
  either.

In short: the actual security boundary this repository relies on is process isolation
(non-root execution, no secrets in the subprocess environment) — the AST validator narrows the
attack surface further but is not claimed, in its own source comments, to be airtight.

### CAM pipeline (separate from, and downstream of, the above)

Once a part exists, the CAM pipeline (feature recognition → setup planning against a
machine-profile capability matrix → toolpath generation → 3D simulation → G-code
post-processing) operates on the resulting geometry — see `ai-engine/app/services/cam/`,
`planning/`, `toolpath/`, `simulation/`, `gcode/`, and the corresponding `web-ui/app/api/cam/**`
BFF routes. Every CAM BFF route independently re-derives the target session/job id from the
caller's authenticated, ownership-checked session rather than trusting a client-supplied id —
this is what prevents one user's CAM request from operating on another user's job.

---

## 14. API / Service Communication

### `web-ui` → `ai-engine`

- **Internal base URL:** `http://ai-engine:8000/api/v1` in Docker (Compose service DNS name);
  `http://127.0.0.1:8000/api/v1` for host-side development (`FASTAPI_URL`).
- **Authentication header:** `X-Service-Key`, value from the server-only `SERVICE_API_KEY`
  environment variable, attached by every call through the single shared helper
  `aiEngineFetch()` (`web-ui/lib/aiEngine.ts`). This helper also strips any caller-supplied
  `X-Service-Key` (case-insensitively) before attaching the real one, and fails closed (throws,
  before any network call) if `SERVICE_API_KEY` isn't configured.
- **Public vs internal:** none of `ai-engine`'s routes are public — `web-ui` is the only holder
  of the service key, and `ai-engine` has no host-published port at all.
- **OpenAPI/docs endpoints:** `ai-engine/app/main.py` gates `/docs` and `/openapi.json` behind
  an `ENABLE_DOCS` environment variable (`"1"`/`"true"`/`"yes"`) — when unset, both are disabled
  (`docs_url=None`, `openapi_url=None`). `ENABLE_DOCS` is **not** set anywhere in
  `docker-compose.yml`, so these are disabled by default in the documented deployment.

### `web-ui` → PostgreSQL

Direct connection via Prisma, application role only (see [Section 10](#10-database-architecture)).

### `ai-engine` → PostgreSQL

Direct connection via `psycopg2`, used specifically by the knowledge-document repository
(`ai-engine/app/services/knowledge/repository.py`) — connections are opened lazily, per
operation, not held open at process startup.

### Endpoint summary

This repository has no generated/published OpenAPI reference in the default deployment (see
above). The full route surface can be enumerated directly from source:

- **`ai-engine/app/api/v1/router.py`** — all `/api/v1/*` routes (CAM: `analyze`, `auto_plan`,
  `toolpaths`, `gcode`, `recommend-machine`, `simulate/prepare`, `process_step`; generation:
  `generate`, `generate/{job_id}`, `edit`, `render`, `upload`, `step`; export: `export-step`,
  `export-stl`, `export-dxf`; assistant: `compare-and-prompt`, `dictionary`; knowledge:
  `documents`, `documents/ingest`, `documents/{doc_id}`, `retrieve`; `blueprint/{session_id}`).
- **`web-ui/app/api/**/route.ts`** — the full BFF surface (auth, admin, sessions, CAM, assistant,
  knowledge, blueprint, outputs, tools, holders, export, generate, render) — see
  [Section 5](#5-repository--directory-structure) for the grouped directory listing.

---

## 15. Security Architecture

This section distinguishes application, container, database, and AI/CAD-execution security, and
states plainly what is **not** claimed.

### Application security

| Control | Implementation |
|---|---|
| Authentication/authorization | JWT session cookie + database-backed `tokenVersion` check (`getSession()`); admin gate (`requireAdmin()`) |
| IDOR protections | CAM/session/simulation/output routes re-derive the target resource id from the caller's own authenticated, ownership-checked session rather than trusting client-supplied ids |
| Password reset controls | Admin-mediated approval, `tokenVersion` bump on approval, DB-enforced at-most-one-pending-request invariant (partial unique index) |
| CSP | Nonce-based, generated per request in `proxy.ts`; `script-src 'self' 'nonce-<random>' 'strict-dynamic'` (plus `'unsafe-eval'` in development only, for React's own debugging use); no `unsafe-inline` in `script-src`; `style-src` still allows `'unsafe-inline'` (not yet hardened); `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'` |
| Rate limiting | See [Section 16](#16-rate-limiting) |
| Required-secret enforcement | `JWT_SECRET`, `SERVICE_API_KEY`, both Postgres passwords use `${VAR:?message}` in Compose — the stack refuses to start without them |

### Container security

| Control | Implementation |
|---|---|
| PostgreSQL network isolation | No host port in the base `docker-compose.yml`; sits only on the `internal: true` `db` network |
| Least-privilege DB role | `vexcad_app` (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, DML-only) used by both runtime services; `vexcad_admin` (superuser) held only by `postgres` and `migrate` |
| Non-root execution | `web-ui` runs as `nextjs` (uid 1001, enforced via a Dockerfile `USER` directive — verified as a clean single-process container); `ai-engine`'s actual application process (uvicorn + workers) runs as `caduser`, dropped via `runuser` in the entrypoint script |
| Project-scoped container naming | No service in `docker-compose.yml` has a hardcoded `container_name:` — verified: two independently-named Compose projects can run the same services simultaneously without a name collision |
| Service-to-service authentication independent of network trust | Even though `ai-engine` is Docker-internal-only, it still requires `X-Service-Key` on every `/api/v1/*` route — network reachability alone is not treated as sufficient |

### Database security

Covered fully in [Section 10](#10-database-architecture) — role separation, DML-only grants,
`PUBLIC` privilege revocation on maintenance databases, atomic role bootstrap with input
validation before any connection is opened.

### AI/CAD execution security

Covered fully in [Section 13](#13-cad-generation--rendering-pipeline) — the AST validator is
explicitly documented (in its own source) as defense-in-depth, not a complete sandbox; the actual
boundary is non-root process execution with a secrets-free environment.

### What is explicitly **not** claimed

- This system is **not** described as "fully secure" or immune to compromise.
- The AST script validator is **not** a complete sandbox, and the source comments say so
  directly.
- `style-src 'unsafe-inline'` in the CSP has not been hardened.
- Rate limiting has no effective per-source-IP dimension unless an operator explicitly
  configures a trusted reverse proxy (`TRUST_PROXY_HEADERS=true`) — see
  [Section 16](#16-rate-limiting).

---

## 16. Rate Limiting

All limits are defined in one place, `web-ui/lib/rateLimit.ts` (`RATE_LIMITS`, `LOGIN_BACKOFF`,
`CONCURRENCY`), backed by a PostgreSQL-stored atomic counter (`RateLimitBucket`, one
upsert-and-return round trip per attempt — correct across restarts and multiple `web-ui`
instances) with a bounded in-process fallback if the table is briefly unreachable. The fallback
never turns into "allow everything," and it never skips the underlying authentication check.

### Attempt-count limits (`RATE_LIMITS`)

| Rule | Identity | Limit |
|---|---|---|
| `registerAccount` | target email | 3 / hour |
| `forgotAccount` | target email (applied identically whether or not the account exists) | 3 / hour |
| `loginIp` | source IP *(only used when a trusted proxy is configured)* | 60 / 15 min |
| `registerIp` | source IP *(trusted-proxy only)* | 10 / hour |
| `forgotIp` | source IP *(trusted-proxy only)* | 10 / hour |
| `adminAction` | authenticated admin | 60 / min |
| `render` | authenticated user | 30 / min |
| `generate` | authenticated user | 10 / min |
| `assistant` | authenticated user | 20 / min |

### Login: capped exponential backoff, not a flat lockout (`LOGIN_BACKOFF`)

The first **3** failures for an account are free (typo tolerance). Each failure after that adds
a delay of `2 × 4^n` seconds before the *next* attempt is even evaluated, **capped at 60
seconds**, resetting after 15 minutes of no failures. This applies identically to every account,
including the admin account — the explicit design goal (stated in source) is that an anonymous
caller who only knows a target's email can never lock out the legitimate holder for more than 60
seconds at a stretch, while a sustained attacker is still limited to roughly one guess per minute.

### Concurrency controls (`CONCURRENCY`)

| Pool | Limits | Purpose |
|---|---|---|
| `loginHash` | 4 running, 16 queued | bcrypt compare for real login attempts |
| `anonHash` | 4 running, 12 queued | bcrypt hash for anonymous register/forgot-password — a **separate** pool so a registration flood can't starve real logins |
| `renderPerUser` | 1 concurrent | per-user cap on the render subprocess pool |
| `renderGlobal` | 8 concurrent | process-wide render cap |

Overflow beyond a pool's queue is rejected immediately with `503`, never queued without bound.
Unknown-email login/forgot-password attempts still run a timing-equalizing dummy hash, but only
when a worker is idle, so they can never delay a real user's request.

### Trusted-proxy behavior

`web-ui` is published directly (no bundled reverse proxy), and Next.js only fills in
`X-Forwarded-For` with the socket address when the client didn't already send one — meaning a
client-supplied value survives untouched and is attacker-controlled. Consequently, **the
per-source-IP rules above are inert unless an operator explicitly sets
`TRUST_PROXY_HEADERS=true`** and places a reverse proxy that both (a) sets/overwrites
`X-Forwarded-For` itself and (b) is the *only* network path to `web-ui` (i.e., port 3000 is not
also separately published). Until then, per-account and per-user limits still fully apply; a
flood of registration/reset attempts using many distinct emails is bounded only by the
concurrency pools (CPU), not by request count.

---

## 17. Testing

### web-ui tests

- **Framework:** Jest `^30.4.2` via `next/jest` (`web-ui/jest.config.ts`), `jsdom` by default,
  `@jest-environment node` per-file where a suite needs real Node APIs (most API-route tests).
- **Command:** `npx jest` from `web-ui/` — there is no `"test"` script declared in
  `package.json`, so `npm test` does **not** work in this repository.
- **Organization:** `web-ui/__tests__/*.test.ts`, one file per finding/feature area (naming
  reflects the audit/remediation history — `vexNNNN_*`, `fN_*`, `pNNN_*`, plus descriptively
  named files for later work such as `docker_d1_d2_d6.test.ts`,
  `password_reset_pending_constraint.integration.test.ts`).
- **Integration tests:** two suites connect to a **real** PostgreSQL instance instead of mocking
  Prisma, and are skipped automatically (via `describe.skip`) when the relevant environment
  variable isn't set:
  - `f4_rate_limit_store.integration.test.ts` (`RATE_LIMIT_TEST_DATABASE_URL`)
  - `password_reset_pending_constraint.integration.test.ts` (`PASSWORD_RESET_TEST_DATABASE_URL`)
- **Known baseline failure:** `vex006_auth.test.ts` has one assertion (`cache-control` header
  on a blueprint-image response) that currently fails against the real route implementation —
  this is a pre-existing, tracked discrepancy, not something introduced by recent work. As of
  this README, the full suite reports **726 passed, 1 failed, 15 skipped** (the skipped tests
  are the two DB-integration suites above, absent a configured test database).

### ai-engine tests

- **Framework:** pytest `8.2.2` (`ai-engine/pytest.ini`: `testpaths = tests`, coverage enabled
  by default via `pytest-cov`).
- **Command:** `pytest` from `ai-engine/` (add `--no-cov` to skip the coverage report for a
  faster run).
- **Important categories:** `test_vex2a001_sandbox.py`/`test_claude_001_builtins_bypass.py`/
  `test_f5_f6_ast_hardening.py` (AST script-validator regression coverage), `test_f2_engine_service_auth.py`/
  `test_p002_service_auth.py` (service-key enforcement), `test_gemini_model_cleanup.py` (model
  allowlist/fallback-chain regression coverage, including a genuinely-executed
  `GoogleGateway` fallback test using lightweight fakes for the optional `google-genai` SDK),
  `test_gcode_safety.py`, `test_cycle_time_engine.py`/`test_lathe_cycle_time.py`/
  `test_rotary_cycle_time.py`, `test_toolpath_engine.py`, `test_blueprint_parameter_extraction.py`,
  `test_vex_audit_011_filename_traversal.py`.
- **Environment-limited exclusions:** `test_geometry_critic.py`, `test_reconstruction_pipeline.py`,
  `test_vex_audit_012_session_job_path_traversal.py`, and `test_knowledge/test_pipeline.py`
  cannot be collected in an environment without `build123d`/`fitz` installed (a real dependency
  gap in that environment, not a code defect). As of this README, excluding those four files,
  the suite reports **444 passed, 0 failed**.

### Security/regression test suites worth knowing about

- `f1_tokenversion_getsession.test.ts` — session/`tokenVersion` invalidation.
- `f2_bff_service_auth.test.ts` / `test_f2_engine_service_auth.py` /
  `test_p002_service_auth.py` — `X-Service-Key` enforcement, both sides.
- `f3_postgres_hardening.test.ts` — Compose topology, credential handling, and (when Docker is
  available) real `docker compose config` assertions.
- `docker_d1_d2_d6.test.ts` — absence of hardcoded `container_name`, `ai-engine`'s
  `depends_on` graph, `OPENROUTER_API_KEY` wiring — same real-`docker compose config` pattern.
- `f4_rate_limiting.test.ts` / `f4_rate_limit_store.integration.test.ts` — rate limiting/
  concurrency, the latter against a real Postgres-backed store.
- `finding1_outputs_dir_hardening.test.ts` / `sessions_auth_before_sync.test.ts` — outputs-path
  hardening and the authenticate-before-filesystem-scan ordering fix.
- `finding2_csp_nonce.test.ts` — CSP nonce behavior, exercised against the real `proxy()`
  function.
- `password_reset_pending_constraint.integration.test.ts` — the DB-level pending-request
  invariant, against a real PostgreSQL instance, including a genuine concurrent-insert race test.
- `test_gemini_model_cleanup.py` — Gemini 2.x exclusion / current allowlist and fallback chain.

Do not assume all tests pass in every environment — the exclusions above are real and
documented, not hidden.

---

## 18. Development Workflow

Based on the actual repository conventions (there is **no CI/CD pipeline** — see
[Section 19](#19-build--production-deployment) — so the steps below are what a contributor is
expected to run manually):

1. **Branch.** A local pre-commit hook exists at `.githooks/pre-commit` that validates branch
   names against `^(main|develop|(feature|bugfix|hotfix|release)\/[a-zA-Z0-9\-]+)$`. It is
   **not** installed by default — a contributor must opt in with
   `git config core.hooksPath .githooks` for it to run.
2. **Make focused changes.** Prefer minimal, scoped diffs — this is the pattern used throughout
   the repository's own remediation history (one finding/feature per commit, tests added
   alongside).
3. **Run tests** for whichever side you changed (see [Section 17](#17-testing)); run both if a
   change spans the BFF/service boundary or Docker Compose.
4. **Lint/typecheck** (web-ui): `npm run lint` (ESLint `^9`, flat config), `npx tsc --noEmit`
   (no dedicated `npm run typecheck` script exists — invoke the compiler directly). **As of this
   README, `npm run lint` reports a large pre-existing backlog (899 problems: 629 errors, 270
   warnings) across the codebase** — it is not currently a clean gate; run it against the files
   you actually touched rather than expecting a clean full-repo run, and do not introduce *new*
   lint errors in files you modify. `npx tsc --noEmit`, by contrast, is currently clean for all
   production code — the only errors it reports (176, as measured for this README) are confined
   to `__tests__/*.test.ts` files, a known artifact of multiple test files declaring the same
   global `Request`/`Response`/`Headers` polyfills (harmless under Jest's per-file isolation, but
   flagged when `tsc` type-checks the whole project as one program).
5. **Docker validation**, for any change touching `docker-compose.yml`/Dockerfiles:
   `docker compose config` (and, if Docker is available, the real-compose-engine test layer in
   `f3_postgres_hardening.test.ts`/`docker_d1_d2_d6.test.ts` covers this automatically).
6. **Security-sensitive changes** (auth, rate limiting, service-key handling, DB roles, CSP,
   script validation): add or update a focused regression test in the corresponding area (see
   [Section 17](#17-testing) for the established naming/organization pattern), and prefer
   mutation-testing your own fix (temporarily revert it, confirm the new test fails, then
   restore it) before considering it done — this is the pattern the existing test suite was
   built with.
7. **Git.** Standard `git add`/`git commit`/`git push`. There is no branch-protection or
   required-review automation configured in this repository (no CI to enforce it) — review
   discipline here is a team practice, not a tooling guarantee.

---

## 19. Build / Production Deployment

**What is actually implemented:** a Docker Compose deployment (`docker-compose.yml`) that builds
both application images, provisions PostgreSQL with least-privilege roles, and starts the three
long-running services in dependency order — see [Section 8](#8-docker-setup). This is the only
deployment path this repository automates.

**What is explicitly development-only:** `docker-compose.dev.yml` (loopback Postgres exposure),
running `web-ui`/`ai-engine` directly on the host (Section 9), and the `--reload` uvicorn flag
shown in that section.

**What has not been automated — stated explicitly, not implied:**

- **There is no CI/CD pipeline.** No `.github/workflows/` directory exists in this repository,
  and no other CI configuration (GitLab CI, CircleCI, Jenkinsfile, etc.) was found. Tests,
  linting, and Docker builds are run manually.
- **There is no cloud deployment script or infrastructure-as-code** (no Terraform, no
  Kubernetes manifests, no cloud-provider CLI scripts) anywhere in this repository. Deploying
  V-XCAD to any specific cloud provider is undocumented and unverified.
- **There is no automated database backup/restore procedure** beyond the manual scripts in
  `web-ui/scripts/` (`export_and_restore_sessions.js`, `copy-db.py`), whose exact operational
  characteristics were not exhaustively verified for this README.
- **TLS/HTTPS termination is not configured anywhere in this repository.** `web-ui` is published
  as plain HTTP on port 3000; putting TLS in front of it (and, if you want working per-IP rate
  limiting, a reverse proxy that sets `X-Forwarded-For` — see [Section 16](#16-rate-limiting)) is
  an operator responsibility this repository does not automate.

---

## 20. Troubleshooting

**Missing environment variables (stack won't start)**
`docker compose up`/`config` fails immediately with `required variable <NAME> is missing a
value: <message>`. This is intentional fail-closed behavior for `JWT_SECRET`, `SERVICE_API_KEY`,
`POSTGRES_ADMIN_PASSWORD`, `POSTGRES_APP_PASSWORD` — set all four in your `.env` (see
[Section 7](#7-environment-variables)).

**Database unavailable**
- Docker: `docker compose ps` — confirm `postgres` shows `healthy`. If `migrate` shows a
  non-zero exit, check `docker compose logs migrate`.
- Host-side dev: confirm `docker-compose.dev.yml` is applied (`-f docker-compose.yml -f
  docker-compose.dev.yml`) and that `POSTGRES_HOST_PORT`/`DATABASE_URL` agree.

**Prisma errors**
- `npx prisma db push` failing with a permission error almost always means `DIRECT_URL` is
  pointed at the application role instead of the admin role — the application role cannot run
  DDL by design (see [Section 10](#10-database-architecture)).
- If the Prisma Client seems stale after a schema change, re-run `npm run prisma:generate`.

**ai-engine unavailable / 401/503 from ai-engine routes**
- `503` from every `/api/v1/*` route: `SERVICE_API_KEY` is unset or blank in `ai-engine`'s
  environment (`ai-engine/app/deps.py` fails closed on this).
- `401`: `web-ui`'s `SERVICE_API_KEY` does not match `ai-engine`'s.
- Docker: confirm `ai-engine` reports `healthy` (`docker compose ps`); if `web-ui` never starts,
  check whether it's stuck waiting on `ai-engine: service_healthy`.

**Gemini API configuration**
- AI generation/CAD Prompt Assistant fails with an API-error response: verify `GOOGLE_API_KEY`
  is set and has quota for the resolved model; check `ai-engine` logs for the underlying
  provider error. The stack itself starts fine without this key — only AI-dependent features
  fail.

**OpenRouter fallback not working**
- Confirm `OPENROUTER_API_KEY` is set in the root `.env` (it's forwarded into `ai-engine` only,
  via `docker-compose.yml`) — before the current Docker hardening pass, this variable was
  documented but never actually wired into the container; it is wired in as of the current
  `docker-compose.yml`.

**Docker build failures**
- `ai-engine` build failures are most often the native `build123d`/`cadquery-ocp` toolchain —
  ensure the base image's system packages (see [Section 6](#6-requirements)) are actually being
  installed (check for `apt-get` errors earlier in the build log).

**Port conflicts**
- `3000` (web-ui) or `5433`/`POSTGRES_HOST_PORT` (dev-only Postgres) already in use: stop
  whatever else is bound, or override `POSTGRES_HOST_PORT` in `.env`. `web-ui`'s port is not
  currently configurable via an environment variable — it's hardcoded as `3000:3000` in
  `docker-compose.yml`.

**Stale containers from a previous, differently-configured run**
- If containers were created before a Compose/Dockerfile change (especially anything touching
  roles, networks, or `depends_on`), recreate them: `docker compose down` (add `-v` **only** if
  you intend to discard the Postgres/outputs volumes) then `docker compose up -d --build`.

**Permission problems on the outputs volume**
- `ai-engine`'s entrypoint re-applies `chown -R caduser:caduser /app/outputs` on every start
  specifically to handle a volume left root-owned by a previous run — if you still see
  permission errors, confirm you're running the current `ai-engine/docker-entrypoint.sh`.

**Python/CAD dependency problems (host-side ai-engine)**
- Missing system libraries for `build123d`/`cadquery-ocp` (`libGL.so`, etc.) almost always mean
  one of the `apt-get`-installed packages in `ai-engine/Dockerfile` (`libgl1`, `libglib2.0-0`,
  `libxrender1`, `libxext6`, `libgomp1`) is missing on the host.

---

## 21. Common Commands

**Docker**
```bash
docker compose build                      # build all images
docker compose up -d --build              # build + start full stack
docker compose down                       # stop (volumes preserved)
docker compose down -v                    # ⚠️ stop AND delete DB + outputs data
docker compose logs -f [service]          # follow logs
docker compose ps                         # status
docker compose up -d --build <service>    # rebuild/recreate one service
docker compose run --rm migrate           # re-run DB bootstrap/migration only
```

**web-ui**
```bash
npm install         # install dependencies
npm run dev          # start dev server (port 3000)
npx jest               # run Jest suite (no "npm test" script is defined)
npm run build          # production build
npm run lint             # ESLint
npx tsc --noEmit          # TypeScript check (no dedicated script)
```

**ai-engine**
```bash
python -m venv .venv && source .venv/bin/activate   # (Windows: .venv\Scripts\Activate.ps1)
pip install -r requirements.txt                       # install dependencies
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000   # run
pytest                                                          # run tests
pytest --no-cov                                                   # run tests without coverage report
```

**Database (web-ui, Prisma)**
```bash
npm run prisma:generate     # generate Prisma Client
npm run prisma:push          # push schema.prisma to the DB (requires admin DIRECT_URL)
npm run db:seed                # run prisma/seed.ts
```

---

## 22. Project Status / Known Limitations

- **No CI/CD.** No `.github/workflows/` or equivalent exists; all testing/linting/Docker
  validation is run manually by contributors.
- **`npm run lint` currently reports a large pre-existing backlog** (899 problems: 629 errors,
  270 warnings, as measured for this README) — linting is not enforced as a clean gate anywhere
  in this repository.
- **`vex006_auth.test.ts` has one known-failing assertion** (a `cache-control` header check on a
  blueprint-image response) — pre-existing, tracked, not caused by recent changes.
- **`docker-compose.dev.yml` is development-only** and must never be treated as a production
  configuration — it exists solely to give host-side tooling loopback access to PostgreSQL.
- **`style-src 'unsafe-inline'` in the CSP has not been hardened to nonce/hash-based.** Only
  `script-src` currently uses a per-request nonce.
- **The AST script validator is explicitly defense-in-depth, not a complete sandbox** — see
  [Section 13](#13-cad-generation--rendering-pipeline). Do not rely on it as the sole protection
  around generated-script execution.
- **No email-based self-service password reset.** Resets require admin approval; there is no
  password-reset email/link flow in this repository.
- **Two independent tool-data model families coexist in the Prisma schema**
  (`ToolDefinition`/`ToolMaterial`/`ToolCoating`/`ToolHolder`/`CuttingData` vs.
  `Tool`/`ToolGeometry`/`ToolOffset`/`Holder`/`ToolAssembly`/`ToolCuttingData`/
  `ToolCompatibility`) — both are live and used by different parts of the application (CAM
  pipeline vs. the Tool Wizard UI). This is architectural technical debt, not a defect, but it's
  worth knowing before adding new tool-related features.
- **`@monaco-editor/react` is a declared frontend dependency with no current import anywhere in
  source** — likely leftover from an earlier UI iteration.
- **`ai-engine/.env.example`'s example `GENAI_MODEL` value differs from the actual runtime
  default** — both are Gemini 3.x, so this is a documentation inconsistency rather than a
  functional problem, but worth fixing.
- **No documented minimum RAM/storage/CPU** for running the full stack; the `ai-engine` image
  build in particular is heavy (full C/C++ toolchain + OpenCascade/`build123d`).

---

## 23. License / Contribution / Contact

No `LICENSE` file, `CONTRIBUTING.md`, or explicit contact information was found anywhere in this
repository. **License terms are therefore unspecified** — do not assume this project is
open-source-licensed for reuse absent an explicit license file. If you are the maintainer and
intend a specific license, add a `LICENSE` file at the repository root; this section will need
to be updated to reflect it.
