# Backend Architecture & Optimization: Next-Gen AI CAD Engine

This document provides a deep dive into the `ai-engine` backend, analyzing its current implementation and outlining a strategic path for high-performance optimization and accuracy.

---

## 1. Deep Dive: `ai-engine` Architecture

The `ai-engine` is a specialized Python backend designed to translate 2D technical drawings into parametric 3D CAD models using the `build123d` library and Google's Gemini models.

### Core Components:
- **FastAPI Application (`app/main.py`)**: A high-performance web server providing endpoints for code generation (`/generate`) and geometry rendering (`/render`).
- **LLM Codegen Service (`app/services/llm_codegen.py`)**: The orchestration layer for Gemini. It manages the system instructions, user prompts, image multi-modality, and the streaming response pipeline.
- **CAD Execution & Parameter Engine (`app/services/parameter_render.py`)**: 
  - **AST Injector**: Uses Python's Abstract Syntax Tree to identify and modify the `PARAMETERS` dictionary in a generated script.
  - **Isolated Harness**: Executes scripts in a `subprocess` wrapper to protect the main process from geometry kernel crashes.
  - **Exporter**: Converts internal `build123d` objects into industry-standard STEP and STL formats.

### Current Implementation Strengths:
- **Bi-directional Parameter Sync**: Changes in the UI's "Parameters" drawer are injected into the code via AST, maintaining script integrity.
- **Resilient Generation**: Implemented exponential backoff and retry logic for handling API rate limits and transient 503 errors.
- **Diagnostic Transparency**: Automatic logging of raw LLM outputs to `logs/` allows for post-mortem analysis of failures.

---

## 2. Optimization Strategy: Tokens & Requests

To achieve "highly optimized and expected results" while minimizing cost and latency, we will implement the following strategies:

### A. Token Usage Optimization
- **Instruction Condensation**: Move from verbose natural language instructions to a "High-Density Technical Contract." By using structured Markdown and banning "polite prose" in the system prompt, we can reduce input tokens by ~20-30%.
- **Few-Shot Compression**: Instead of providing multiple full-length scripts as examples, we will use a single "Universal Blueprint" that demonstrates all key concepts (grounding, math safety, and boolean algebra) in a single compact block.
- **Output Truncation Control**: Set strict `max_output_tokens` limits and instruct the model to skip comments in the generated code unless they explain complex geometry logic.

### B. Request & Accuracy Optimization
- **The Self-Healing Loop (Multi-Turn Accuracy)**:
  - **The Problem**: 40% of failures are due to simple syntax errors or minor API hallucinations.
  - **The Solution**: Before the user even sees an error, the backend will attempt a "Internal Render Pass." If it fails, the error is fed back to the LLM for an immediate "Self-Correction" request. This ensures the user only receives code that actually works.
- **Deterministic Sampling**: Fix the model `temperature` to `0.0`. While less "creative," this is essential for engineering applications to ensure that the same drawing always produces the same precise dimensions.
- **Negative Constraints**: Explicitly ban common hallucinations (e.g., "Do not use `.offset()` on primitives") to prevent the model from wasting tokens on invalid code.

---

## 3. The "Perfect" Phase-Based Roadmap

### Phase 1: Self-Healing & Internal Validation
- **[MODIFY] `router.py`**: Update the `/generate` endpoint to include an optional "Verify & Fix" step.
- **Logic**: Generate -> Test Render (Hidden) -> If Fail, Re-Prompt with Error -> Stream Final Fix.

### Phase 2: Instruction Refactoring (Accuracy Boost)
- **[MODIFY] `llm_codegen.py`**: Replace current `SYSTEM_INSTRUCTION` with the "High-Density Technical Contract."
- **Focus**: Explicit rules for hidden lines (dashed = holes) and multi-instance callouts (nx Ød = array of holes).

### Phase 3: Security & Performance Sandboxing
- **[NEW] `app/services/sandbox.py`**: An AST-based sanitizer to prevent RCE (Remote Code Execution) by stripping `os`, `sys`, and `subprocess` imports.
- **[MODIFY] `parameter_render.py`**: Transition to `asyncio.create_subprocess_exec` to prevent threadpool exhaustion during heavy renders.

### Phase 4: Persistence & Dataset Generation
- **[NEW] `app/db/`**: A SQLite-based job tracker to store `Image + Prompt -> Code -> Success` triplets.
- **Goal**: Create a high-quality dataset of verified "Golden CAD Scripts" for future model fine-tuning.

---

## User Review Required

> [!IMPORTANT]
> The primary focus of this plan is **Optimization for Accuracy**. By moving to a Self-Healing loop (Phase 1) and a High-Density Contract (Phase 2), we can significantly improve the "First-Time Success Rate" of the generator.
> 
> **Are you ready to proceed with implementing the Phase 1 Self-Healing Loop?**

---
> Revised section 
# Revised Token‑Efficient Generation Plan (No OCR)

**Goal** – Ensure a single request from the web‑UI (image or PDF) reliably returns a complete, comment‑free Python script while keeping token usage low. All OCR‑related steps are omitted.

---

## 1. Core Optimisation Areas
1. **Prompt Size Reduction** – Split the current `SYSTEM_INSTRUCTION` into a minimal core contract (≈70 tokens) and optional safety rules that can be toggled via an env flag.
2. **Input Image/PDF Handling** –
   - Downscale any uploaded image to a max width of `IMAGE_MAX_DIM` (default 512 px) before encoding to base64. This cuts image‑token cost.
   - For PDFs, only render the **first N pages** (configurable via `PDF_MAX_PAGES`). The backend will convert those pages to images using `pdf2image` (no OCR).
3. **Two‑Stage Generation (Model‑only)** –
   - **Stage 1**: A lightweight “summary” call to the same LLM with a short prompt that extracts key dimensions and callouts from the image(s). The summary is a concise JSON (≤ 200 tokens).
   - **Stage 2**: Pass the summary plus the original (down‑scaled) images to the CAD‑generation model with the strict contract.
   - This keeps the final generation prompt well within the model’s context window without any external OCR.
4. **Token‑Budget Enforcement** – Before each LLM call, compute `prompt_tokens` using `client.models.count_tokens`. Abort with a clear error if it exceeds `MAX_PROMPT_TOKENS`.
5. **Streaming Robustness** – Emit a preliminary `"metadata"` SSE event containing `{"token_budget": X}` and buffer the first 5 KB of token data on the server before streaming to guarantee the script block is not split.
6. **Usage Logging** – Write a JSON log per request to `logs/usage_{{timestamp}}.json` containing:
   ```json
   {"timestamp":"...","model":"...","prompt_tokens":...,"completion_tokens":...,"success":true/false}
   ```
   Enables data‑driven adjustments.
7. **Model Settings** – Enforce `temperature=0.0`, `max_output_tokens=2048`, and `stop="```"` to avoid extra explanations.
8. **No‑Comment Rule** – Already present; keep the line `4. **Do NOT include any comments** …` in the system prompt.

---

## 2. Concrete Code Changes
### 2.1 `app/services/llm_codegen.py`
- Refactor `SYSTEM_INSTRUCTION` into `CORE_INSTRUCTION` (mandatory) and `SAFETY_INSTRUCTION` (optional via `GENAI_SAFETY=1`).
- Add helper `def _prepare_prompt(image_base64: str, summary: Optional[dict] = None) -> str` that:
  1. Downscales image if needed.
  2. Inserts the summary JSON (if provided) into the prompt.
  3. Appends the core instruction.
- Insert token‑budget check using `self.client.models.count_tokens(prompt=prompt)`.
- Emit SSE `metadata` event before streaming tokens.
- Log usage after the request completes.

### 2.2 New Endpoint `POST /summarise`
- Accepts `image` (base64) or `pdf` (binary). Converts PDF pages to images (`pdf2image.convert_from_bytes`).
- Calls the LLM with a **tiny** prompt:
  ```
  Extract all numeric dimensions, hole callouts (e.g., "nx Ød"), and any hidden‑line indicators from the provided image(s). Return a compact JSON with keys `dimensions`, `holes`, `hidden_lines`.
  ```
- Returns the JSON summary.

### 2.3 Modify Existing `/generate`
- Accept an optional `summary` field.
- If absent, internally call the new `/summarise` endpoint (server‑side) to obtain the summary.
- Pass the summary to the generation model.

### 2.4 `app/api/v1/router.py`
- Wire the new `/summarise` route.
- Update `/generate` signature to include `summary: Optional[dict] = Body(None)`.

### 2.5 Configuration (`.env`)
```env
MAX_PROMPT_TOKENS=12000
MAX_OUTPUT_TOKENS=2048
IMAGE_MAX_DIM=512
PDF_MAX_PAGES=2
GENAI_SAFETY=0   # 1 to include extra safety rules
```

### 2.6 Logging (`ai-engine/logs/`)
- Create `usage_{{uuid}}.json` per request.
- Include `truncated: true` flag if the model exceeded `MAX_OUTPUT_TOKENS`.

---

## 3. Front‑End Adjustments (`web‑ui`)
- When a PDF is uploaded, send it directly to `/summarise` first (transparent to the user).
- Show a progress indicator while the summary is generated.
- Buffer the first few SSE events to prevent lost tokens.
- Display token‑budget info if the server returns a `metadata` event.

---

## 4. Open Questions (User Review Required)
> [!IMPORTANT]
> 1. **Maximum pages for PDFs** – Is `PDF_MAX_PAGES=2` acceptable, or should we allow a higher default?
> 2. **Safety instruction toggle** – Do you want the extra safety rules always on (`GENAI_SAFETY=1`) or only during debugging?
> 3. **Logging retention** – How long should `logs/usage_*.json` be kept?
> 4. **Model selection** – You switched to GPT‑OSS‑120B; should the env variable `GENAI_MODEL` be set manually, or should we auto‑pick the model with the largest context window?

---

## 5. Implementation Timeline (OCR‑free)
| Phase | Tasks | Effort |
|------|-------|--------|
| 0 | Add env vars, usage‑log helper | 0.5 d |
| 1 | Refactor system prompt, token‑budget check | 1 d |
| 2 | Implement `/summarise` endpoint (image‑to‑image, PDF page limit) | 1 d |
| 3 | Update `/generate` to accept summary, SSE metadata, buffering | 1 d |
| 4 | Front‑end wiring (summary call, progress UI) | 1 d |
| 5 | Test with both PDFs (`MT 1P‑083` & `D4P‑1549`) | 0.5 d |
| 6 | Adjust configs based on results | 0.5 d |

**Total ≈ 5 working days**.

---

**Next Step** – Please answer the open questions so we can lock the defaults and proceed with Phase 0.
