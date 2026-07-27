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
- Automated Feature Recognition (drilling, pocketing, turning, etc.)
- 88 Industry-standard CNC Machine Profiles (Haas, DMG MORI, Okuma, Makino, Hermle, etc.) with real-world controllers (Fanuc, Siemens, Heidenhain)
- Comprehensive Material Profiles with Feeds & Speeds calculation capabilities
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
- DATABASE_URL=postgresql://cad_user:cad_pass@localhost:5432/cad_db?schema=public
- NEXT_PUBLIC_FASTAPI_URL=http://127.0.0.1:8000/api/v1

Note:

- If you prefer `.env.local`, copy the same keys there as well.

## Quick Start (Local Development)

### 1) Start PostgreSQL

From repo root:

```bash
docker compose up -d
```

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
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Health check:

```bash
curl http://127.0.0.1:8000/health
```

### 3) Start web-ui 

```bash
cd web-ui
cp .env.example .env  # Windows: Copy-Item .env.example .env
npm install
npm run prisma:generate
npm run prisma:push
npm run dev
```

Open:

- http://localhost:3000

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
