# VexCAD Production CAM System

VexCAD is a full-stack, AI-powered Computer-Aided Manufacturing (CAM) system designed for production.

It combines:

- A Next.js workspace UI (chat, parameter editing, setup planning, 3D toolpath simulation, and g-code generation)
- A FastAPI AI engine (Feature recognition, setup planning, and toolpath/G-Code generation)
- PostgreSQL + Prisma for session persistence

The platform allows users to upload STEP files or use AI to generate base CAD geometries, automatically extracts machinable features, plans 3/4/5-axis machine setups, and outputs production-ready G-Code.

## High-Level Architecture

- web-ui: Next.js app that provides the user interface and BFF API routes
- ai-engine: FastAPI service that runs LLM code generation and CAD rendering
- postgres: persistence layer used by Prisma in web-ui

Data flow:

1. User submits prompt + image/PDF or uploads a STEP file in UI
2. web-ui POST /api/generate proxies request to ai-engine /api/v1/generate or process STEP
3. ai-engine extracts features and generates setup plans based on Machine Profile capabilities
4. UI receives the setup plans and machinable features
5. User edits parameters and operations in the HITL (Human-in-the-Loop) UI, then clicks Generate Toolpaths
6. ai-engine validates setups and creates detailed Toolpath Segments for simulation
7. UI loads 3D model, rotates dynamically per active setup, and visualizes toolpaths
8. User clicks Generate G-Code to retrieve final production files

## Repository Structure

```text
vexcad/
├── docker-compose.yml
├── README.md
├── docs/
│   ├── PROJECT.md
│   └── technical_details.md
├── ai-engine/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/v1/router.py
│   │   ├── models/schemas.py
│   │   └── services/
│   │       ├── llm/
│   │       ├── planning/
│   │       ├── simulation/
│   │       ├── tooling/
│   │       ├── toolpath/
│   │       └── validation/
│   ├── outputs/
│   ├── requirements.txt
│   └── .env
└── web-ui/
    ├── app/
    │   ├── page.tsx
    │   ├── layout.tsx
    │   └── api/
    │       ├── cam/
    │       ├── generate/
    │       ├── render/
    │       └── sessions/
    ├── components/
    │   ├── HitlWorkspace.tsx
    │   └── ui/sonner.tsx
    ├── prisma/schema.prisma
    ├── package.json
    └── lib/prisma.ts
```

## Core Features

- AI-driven CAD generation from images/prompts or direct STEP file uploads
- Advanced Geometry Reasoning (Constraint Solving, Projection Reasoning, Topology Building)
- 2D Blueprint and Projection Validation
- Integrated Knowledge Retrieval System
- Automated B-Rep Feature Recognition (drilling, pocketing, turning, etc.)
- 88 Industry-standard CNC Machine Profiles (Haas, DMG MORI, Okuma, Makino, Hermle, etc.) with real-world controllers (Fanuc, Siemens, Heidenhain)
- Comprehensive Material Profiles with Feeds & Speeds calculation capabilities
- Interactive Tool Wizard for defining custom cutting tools and holder assemblies
- Built-in support for Micro-machining and advanced tooling profiles
- Intelligent Setup Planning for 3-axis, indexed 4/5-axis, and mill-turn machines
- Interactive Operation Tree for editing and managing generated toolpaths
- 3D Viewport with dynamic setup rotation and real-time toolpath simulation
- Accurate Machining Cycle Time estimation based on exact machine acceleration and kinematic limits
- Modern, sleek UI interface tailored for an industrial-grade professional CAM experience
- G-Code generation with configurable post-processors
- Comprehensive readiness evaluation blocking unsupported features
- Session persistence in PostgreSQL via Prisma

## Prerequisites

- Python 3.11+ recommended
- Node.js 20+ recommended
- npm 10+ recommended
- Docker Desktop (for PostgreSQL via docker-compose)

## Environment Variables

This repository includes safe environment templates:

- ai-engine/.env.example
- web-ui/.env.example

Create real env files from them before running the apps.

Windows (PowerShell):

```powershell
Copy-Item ai-engine/.env.example ai-engine/.env
Copy-Item web-ui/.env.example web-ui/.env
```

macOS/Linux:

```bash
cp ai-engine/.env.example ai-engine/.env
cp web-ui/.env.example web-ui/.env
```

### ai-engine/.env

Required:

- GOOGLE_API_KEY: Gemini API key

Optional tuning:

- GENAI_MODEL (example: gemini-3.1-flash-preview)
- GENAI_MAX_RETRIES (default code fallback: 5)
- GENAI_RETRY_BASE_DELAY (default code fallback: 1.5)
- GENAI_MAX_RETRY_DELAY (default code fallback: 60)

### web-ui/.env

Required:

- FASTAPI_URL=http://127.0.0.1:8000/api/v1
- DATABASE_URL: PostgreSQL connection string for the application role (see [Database](#database)); see `web-ui/.env.example`
- SERVICE_API_KEY: must equal the ai-engine's `SERVICE_API_KEY` (server-side only, never `NEXT_PUBLIC_*`)
- NEXT_PUBLIC_FASTAPI_URL=http://127.0.0.1:8000/api/v1

Note:

- If you prefer `.env.local`, copy the same keys there as well.

## Quick Start (Local Development)

### 1) Start PostgreSQL

PostgreSQL is **not published to the network**. There are no default passwords: create the repo-root
`.env` from `.env.example`, set `POSTGRES_ADMIN_PASSWORD`, `POSTGRES_APP_PASSWORD`, `SERVICE_API_KEY`
and `JWT_SECRET`, then from the repo root start the database **for host-side development** with the
dev override (binds `127.0.0.1:5433` only — never `0.0.0.0`):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm migrate   # roles + schema + grants
```

See [Database](#database) for the role model and for the full-stack (`docker compose up`) workflow.

### 2) Start ai-engine

```bash
cd ai-engine
cp .env.example .env  # Windows: Copy-Item .env.example .env
python -m venv .venv
# Windows
. .venv/Scripts/activate
# macOS/Linux
# source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Every `/api/v1` route requires the `X-Service-Key` header (set `SERVICE_API_KEY` in `ai-engine/.env`
and the same value in `web-ui/.env`). Keep the engine on loopback: it is an internal service.

Health check (the only unauthenticated route):

```bash
curl http://127.0.0.1:8000/health
```

### 3) Start web-ui 

```bash
cd web-ui
cp .env.example .env  # Windows: Copy-Item .env.example .env
npm install
npm run prisma:generate
npm run dev
```

Schema changes are applied by the `migrate` service (step 1). If you run the Prisma CLI on the host
instead (`npm run prisma:push`), `DIRECT_URL` in `web-ui/.env` must be the **admin** role; the
application role cannot run DDL by design.

Open:

- http://localhost:3000

## Database

Architecture: `web-ui`, `ai-engine` and the one-shot `migrate` service reach PostgreSQL only over the
internal Docker `db` network (`internal: true` — no route to the outside). The database has **no published
host port** in `docker-compose.yml`.

| Role | Purpose | Privileges | Who receives it |
|---|---|---|---|
| `POSTGRES_ADMIN_USER` (default `vexcad_admin`) | bootstrap / owner | cluster **superuser** (the postgres image makes `POSTGRES_USER` one) | `postgres` (sets it to create the role) and `migrate` (connects as it) — **never** `web-ui` or `ai-engine` |
| `POSTGRES_APP_USER` (default `vexcad_app`) | runtime | `LOGIN`, not superuser/createdb/createrole; `SELECT/INSERT/UPDATE/DELETE` on tables; no DDL, no `TRUNCATE` | `web-ui`, `ai-engine` |

`migrate` is idempotent and runs on every `docker compose up`: it creates/updates the application role,
applies the Prisma schema with `prisma db push` (which refuses destructive changes unless you force it),
and then re-grants DML-only access. `web-ui` starts only after it succeeds.

Full stack:

```bash
cp .env.example .env      # then fill in the secrets — compose refuses to start without them
docker compose up -d --build
```

Use hex/alphanumeric secrets (they are embedded in connection URLs), e.g. `openssl rand -hex 24`.

Host-side development (Prisma CLI, `npm run dev`, psql, `web-ui/scripts/*`):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres   # 127.0.0.1:5433 only
```

To (re-)run just the bootstrap/migration step on its own — for example after changing
`prisma/schema.prisma` without restarting the whole stack:

```bash
docker compose run --rm migrate
```

(`migrate` intentionally has no fixed container name, so this is safe to run repeatedly and
alongside a second instance of this stack on the same host; see the compose file comment.)

### Upgrading an existing installation (existing `cad_postgres_data` volume)

`POSTGRES_USER` / `POSTGRES_PASSWORD` only take effect when the data volume is first created, so the old
`cad_user` / `cad_pass` credential stays inside an existing volume until you rotate it. Either:

- **Disposable data:** `docker compose down -v`, then `docker compose up -d --build` (destroys the volume), or
- **Keep the data:** keep the existing superuser name, rotate its password, then bring the stack up:

  ```bash
  # with the OLD container still running:
  docker exec -it vexcad_postgres psql -U cad_user -d cad_db -c "ALTER ROLE cad_user PASSWORD '<new admin password>'"
  # in .env:  POSTGRES_ADMIN_USER=cad_user   POSTGRES_ADMIN_PASSWORD=<new admin password>   POSTGRES_APP_PASSWORD=<new app password>
  docker compose up -d --build
  ```

  `migrate` will then create the least-privilege application role and restrict it to DML.

`web-ui/scripts/export_and_restore_sessions.js` needs `DOCKER_DATABASE_URL` (target connection string); no
credentials are stored in the repository.

## Rate limiting

Abuse controls live in the Next.js BFF (`web-ui/lib/rateLimit.ts`); every limit and window is defined once
in that file (`RATE_LIMITS`, `CONCURRENCY`). Attempt counters are stored in PostgreSQL (`RateLimitBucket`,
one atomic upsert per attempt, so they survive restarts and work across instances). If the table is
unavailable the limiter falls back to a bounded in-process counter — it never fails open and never skips
authentication.

| Endpoint | Identity | Limit (default) |
|---|---|---|
| `POST /api/auth/login` | target account (email, `admin` alias canonicalised) | 10 attempts / 15 min, reset on success |
| `POST /api/auth/register` | email | 3 / hour |
| `POST /api/auth/forgot-password` | email (applied identically whether or not the account exists) | 3 / hour |
| `/api/admin/password-reset-requests/**` | authenticated admin | 60 / min |
| `POST /api/render` | authenticated user | 30 / min, ≤2 concurrent per user, ≤8 process-wide |
| `POST /api/generate` | authenticated user | 10 / min |
| `POST /api/assistant/compare` | authenticated user | 20 / min |

Password hashing is additionally bounded by concurrency pools (login 4 running + 16 queued; the anonymous
register/forgot-password flows use a **separate** pool of 2 + 8 so a registration flood cannot starve logins).
Overflow is rejected immediately with `503`, not queued without bound. Unknown-email logins run a dummy hash
only when a worker is idle, so they can never delay a real user.

**What is and is not protected.** `X-Forwarded-For` is attacker-controlled while web-ui is published
directly (Next.js only fills it in when the client did not send one), so the app **does not use it** by
default — there is no per-IP limit out of the box. Consequently:

- Guessing passwords for one account, resetting-request spam against one address, and per-user cost abuse
  are limited.
- A flood of registrations / reset requests using *many different* emails is bounded only by the hashing
  pools (CPU), not by count. Closing this needs a trusted source address or email verification.
- `GET /api/sessions` still does unauthenticated per-request disk scanning (tracked separately).

To enable per-IP limits, put a reverse proxy in front that sets `X-Forwarded-For`, make it the **only** route
to web-ui (do not publish port 3000), and set `TRUST_PROXY_HEADERS=true`. The right-most `X-Forwarded-For`
entry (the one your proxy appended) is used; client-supplied left-most values are ignored.

Apply the schema (`docker compose up` runs `migrate`, or `npm run prisma:push` with the admin `DIRECT_URL`)
so the `RateLimitBucket` table exists.

## API Summary

### ai-engine

- POST /api/v1/cam/auto-plan
    - Analyzes STEP files to extract machinable features and proposes machine setups.
- POST /api/v1/cam/toolpaths
    - Generates full 3D simulation-ready toolpath sequences for chosen setups.
- POST /api/v1/cam/gcode
    - Post-processes planned toolpaths into specific machine-ready G-Code.
- POST /api/v1/cam/simulate
    - Generates timeline simulations for material removal verification.
- POST /api/v1/generate (Legacy CAD)
    - Generates base CAD geometry from images/prompts.
- POST /api/v1/render (Legacy CAD)
    - Renders parameterized code to STEP/STL artifacts.

### web-ui BFF routes

- POST /api/cam/*
    - Proxies all advanced CAM operations to the ai-engine.
- POST /api/generate
    - Validates AI CAD input, creates session, proxies SSE upstream.
- POST /api/render
    - Proxies render request, stores artifacts URLs in CadSession.

## Typical User Workflow

1. Upload STEP file or prompt/image to generate base CAD
2. Review automatically recognized features and proposed setups
3. Select Machine Profile (e.g. 3-Axis Mill vs 5-Axis) and update capability matrix
4. Auto Plan Operations and review the generated Operation Tree
5. Simulate toolpaths in 3D to verify safety and intent
6. Generate G-Code and download for production

## Troubleshooting

### App does not start

- Check Python venv activation and dependency install
- Check Node modules are installed in web-ui
- Ensure Docker PostgreSQL is running

### Generate fails immediately

- Verify GOOGLE_API_KEY is set and valid
- Verify selected model has quota
- Check ai-engine logs for upstream model errors

### Toolpaths / G-Code Generation is Blocked

- Ensure that the active Machine Profile supports the required operation (e.g., trying to generate a turning profile on a 3-axis mill).
- Verify tool lengths in the Tool Library are sufficient for the feature depth.
- The CAM Readiness Evaluator explicitly blocks G-Code generation if any safety limits are exceeded.

### Render succeeds but geometry looks old

- The frontend appends cache-busting query params per sync to force fresh fetch.
- If still stale, verify session_id and output files in ai-engine/outputs.

## Security and Operational Notes

- Never commit real API keys to source control
- Restrict CORS in production (currently permissive for local dev)
- Place ai-engine behind auth/rate limiting before public exposure
- Add structured logging/metrics for generate/render latency and failures

## Additional Documentation

- Product/project narrative: docs/PROJECT.md
- Deep implementation details: docs/technical_details.md
