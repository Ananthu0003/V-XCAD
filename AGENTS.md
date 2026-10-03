# [FILE: AGENTS.md]

### AI Code Review Checklist

This checklist must be used by AI assistants whenever they are asked to review code. Ensure the code is evaluated against the following categories:

#### 1. Functional Quality
- Functional correctness and business logic validation
- Edge cases and boundary conditions
- Exception and null handling
- Input validation

#### 2. Security
- SQL Injection, XSS, and Authentication/Authorization flaws
- Sensitive data exposure and hardcoded secrets
- Insecure API usage and OWASP Top 10 vulnerabilities

#### 3. Performance
- Memory leaks and unnecessary object creation
- Performance bottlenecks and database optimization
- Inefficient loops, redundant API calls, caching opportunities

#### Output Format
Whenever you conduct a review, categorize the findings as:
- **Critical**
- **High**
- **Medium**
- **Low**

For every finding, you MUST provide:
- Issue description
- Impact
- Root cause
- Recommended fix
- Improved code example

## Project Context & Architecture

### High-Level Architecture
VexCAD is a full-stack, AI-powered CAM system designed for production. The architecture follows a Backend-for-Frontend (BFF) pattern:
- **Frontend (web-ui)**: A Next.js (React) application serving as the UI and BFF proxy. It handles session persistence using Prisma and PostgreSQL.
- **Backend (ai-engine)**: A FastAPI (Python) service that executes the core CAM pipeline (LLM CAD generation, B-Rep analysis, feature recognition, setup planning, toolpath calculation, and G-Code post-processing).
- **Storage**: Sessions are persisted in PostgreSQL. Artifacts (STEP files, G-Code, JSON traces) are often written to the local filesystem (`storage/jobs/`).

### Business Rules & CAM Constraints
- **Machine Limitations**: All toolpaths and operations MUST be validated against the active Machine Profile capabilities (e.g., blocking 5-axis operations on a 3-axis mill).
- **Pipeline Integrity**: The CAM pipeline must flow sequentially: `STEP Import -> Blueprint & Projection Validation -> Geometry & Topology Reasoning -> B-Rep Feature Recognition -> Setup Planning -> Operation Planning -> Toolpath Generation -> G-Code Post-Processing`.
- **Validation**: G-Code generation is strictly blocked if any operation violates coordinate safety, geometry mapping, or machine capability constraints.

### Coding Guidelines
- **Backend (Python)**:
  - Use Python 3.11+ features.
  - Strictly use Pydantic (v2) for all data validation, schemas, and API request/response models.
  - Rely on dependency injection where applicable in FastAPI routes.
- **Frontend (TypeScript/Next.js)**:
  - Use React Server Components where beneficial, and Client Components for interactive UI elements.
  - Use Tailwind CSS and Shadcn UI (or similar) for styling.
  - Interact with the database exclusively via Prisma.

### Module Dependencies
- The `web-ui` route handlers act as a proxy, forwarding CAM-intensive tasks directly to the `ai-engine` via HTTP. 
- The `ai-engine` relies on external LLM gateways (e.g., OpenRouter, Google Gemini) for intelligent feature extraction and base CAD generation.

### Important Implementation Patterns
- **Pipeline Pattern**: The backend orchestrates complex CAM tasks via the `CamPipelineManager`, passing state (Features, Setups, Operations) sequentially.
- **Data Hydration**: Responses from the `ai-engine` often include large arrays of geometry definitions (`ToolpathSegment`) that the frontend parses to render 3D toolpaths in real-time.
- **Fail-Safe Generation**: LLM interactions have built-in retry mechanisms and fallback strategies to ensure consistent outputs.
