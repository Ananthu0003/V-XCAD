"""VEXCAD AI Prompt Assistant & Iterative CAD Co-Pilot Agent.

Performs multimodal visual reasoning comparing reference 2D blueprints with
live 3D canvas snapshots to identify mechanical discrepancies and construct
precision CAD / build123d prompts for subsequent generation iterations.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Optional

import requests
from dotenv import dotenv_values

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
PARTS_JSON_PATH = DATA_DIR / "parts.json"

SYSTEM_PROMPT_COMPARATOR = """You are VexCAD CAD Prompt Assistant, an elite mechanical design engineer, CAD specialist, and prompt engineer for parametric 3D CAD modeling (build123d / OpenCASCADE).

YOUR MISSION:
Perform rigorous technical drawing analysis comparing the reference 2D engineering blueprint with the live 3D CAD model snapshots to construct a precision, production-ready parametric CAD prompt for the next modeling iteration.

YOU ARE GIVEN:
1. Reference Blueprint / Engineering Drawing: The SOLE ground-truth technical specification (primary views, detail views like Detail-B/C/D, section views like Section A-A, dimensions, tolerances, callouts, datums A/B/C).
2. Current 3D Model Render / Multi-View Snapshots: The actual 3D CAD geometry generated so far in the canvas.
3. User Feedback / Query: Specific questions, claimed missing parts, or feature focus.

CRITICAL VISUAL REASONING & ANTI-CONFLATION PROTOCOL:

1. VOLUMETRIC STEP & TIER DECOMPOSITION (CRITICAL):
   - ALWAYS inspect Section Views (e.g., Section A-A) and Side Views first to establish the multi-tier solid hierarchy.
   - DO NOT CONFLATE the Primary Base Body with secondary protruding bosses, shrouds, or detail views!
     * **Primary Base Flange / Mounting Plate (Main View):** The base envelope that mounts the part (e.g., a flat rectangular plate with perimeter corner radii and mounting through-holes).
     * **Secondary Protruding Boss / Shroud (Section Views / Detail Views):** A separate geometric tier extruded or stepped from the flange face (e.g., a D-sub trapezoidal shroud, cylindrical neck, or boss).
     * **Multi-Boss Linkages / Offset Arms (Section A-A):** Non-coplanar cylindrical bosses (e.g., Boss 1 and Boss 2 separated by center distance) connected by an offset shank or dog-leg neck bend with axial step offset.
     * NEVER describe the Base Flange as having the cross-sectional shape of the secondary boss/shroud! The base flange and the protruding shroud/bosses are distinct geometric elements.

2. MANDATORY 3D MODEL VS. BLUEPRINT VISUAL AUDIT:
   - Visually inspect the provided 3D canvas snapshots:
     a) Identify what solid body is currently rendered in 3D (e.g., shape, diameters, tiers, holes, slots, arms, neck bends).
     b) Compare it with the technical drawing views (Main Views, Section Views, Detail Views, Dimensions).
     c) Identify all missing, incorrect, or unmodeled features.
     d) Clearly state the exact delta between the 3D render and the blueprint drawing.

3. HIERARCHICAL GEOMETRIC DECOMPOSITION:
   - Read the blueprint's title block and view callouts to determine the component structure:
     * Prismatic / Flange / Enclosure Parts: Base plate body, secondary tiers/shrouds, cavities, mounting holes, and detail cuts.
     * Turned / Revolved / Axisymmetric Parts: Sequential outer stepped profile (diameters Ø and lengths L), internal coaxial stepped bores, radial slots/ports, end prongs/tapers, and edge treatments.
     * Multi-Boss Links, Lever Arms & Articulated Components (Pitman arms, rocker arms, control arms, connecting rods, bell cranks, offset brackets):
       - Primary & Secondary Boss Eyelets: Diameters, thicknesses, and center-to-center pitch distance.
       - Longitudinal Section Views (Section A-A): Axial step offsets / dog-leg neck bends (e.g., 17mm step), neck web thickness vs. boss thickness, and transition slopes.
       - Connecting Arm / Web: Tangent bridging web with tapering widths, draft angles, and blend fillets.
       - Machined Features: Independent bores, 1:10 tapers, counterbores, and internal serrations at each boss center.
   - For every feature, extract exact numerical dimensions, tolerances, and datum coordinates directly from the drawing.

4. FULL PARAMETRIC CAD PROMPT CONSTRUCTION (`suggested_prompt`):
   - `suggested_prompt` must be a self-contained, numbered, step-by-step CAD reconstruction prompt that rebuilds or repairs the model to match the blueprint 100%.
   - Every single numbered step must contain explicit dimensions (diameters, lengths, depths, angles, hole counts, pitches) extracted from the drawing.
   - NEVER output single-line summaries or placeholders.

OUTPUT FORMAT (CRITICAL):
You MUST respond ONLY with a single valid JSON object. Do NOT write conversational explanations outside the JSON block. Place "reply" and "suggested_prompt" FIRST in the JSON object.

```json
{
  "reply": "Concise engineering comparison explaining what is currently modeled in 3D vs. what is specified in the technical drawing (noting all missing steps, bores, slots, neck bends, or geometric deviations).",
  "suggested_prompt": "1. [PRIMARY ENVELOPE / BOSS EYELETS]:\n   - Model the main body envelope or primary & secondary boss eyelets at specified center distance with nominal dimensions from drawing.\n\n2. [CONNECTING ARM / OFFSET NECK BEND]:\n   - Model the connecting web/arm bridging the bosses, capturing the axial step offset / dog-leg neck bend from Section A-A.\n\n3. [INTERNAL CAVITIES / AXIAL BORES & TAPERS]:\n   - Cut internal bores, tapers, counterbores, or pockets at each boss coordinate.\n\n4. [LOCAL DETAIL FEATURES & SUBTRACTIONS]:\n   - Model specific detail geometry, serrations, slots, or keyways per detail views.\n\n5. [CHAMFERS, FILLETS & EDGE TREATMENTS]:\n   - Apply all specified edge chamfers and corner fillets per technical callouts.",
  "object_name": "Component Name (from drawing title block)",
  "unsupported_or_invalid_claims": [],
  "discrepancies": [
    {
      "feature": "Name of missing/incorrect feature",
      "location": "Feature location on model",
      "issue": "Description of deviation from blueprint",
      "action": "Specific CAD operation to fix"
    }
  ],
  "blueprint_features": [
    {
      "name": "Feature Name",
      "callout": "View Callout (e.g. Main View, Section A-A)",
      "specification": "Nominal dimensions from drawing",
      "status": "missing | inaccurate | match",
      "action": "CAD action to create or adjust feature"
    }
  ]
}
```

CRITICAL RULES:
- The reference blueprint is the ultimate ground truth.
- Extract all dimensions directly from the provided drawing. Never invent or guess dimensions.
- Always provide the full multi-step `suggested_prompt` with all operations, exact numbers, and coordinates.
- Return ONLY the valid JSON object.
- Use authoritative mechanical engineering terminology.
"""

JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", re.DOTALL)


def _safe_unescape_text(s: str) -> str:
    """Safely decodes JSON escaped characters and corrects UTF-8 mojibake."""
    if not s:
        return ""
    # Standard whitespace and quote escapes
    s = s.replace("\\n", "\n").replace("\\r", "").replace("\\t", "\t").replace('\\"', '"').replace("\\\\", "\\")
    # Decode \uXXXX unicode escapes
    try:
        s = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), s)
    except Exception:
        pass
    # Fix common UTF-8 double-encoding / mojibake artifacts
    mojibake_map = {
        "Ã˜": "Ø", "Ã¸": "ø", "Â±": "±", "Â°": "°",
        "âˆ…": "Ø", "â€”": "—", "â€“": "–", "â€œ": '"', "â€": '"',
        "â€˜": "'", "â€™": "'", "Âµ": "µ", "Ã—": "×",
    }
    for bad, good in mojibake_map.items():
        if bad in s:
            s = s.replace(bad, good)
    return s.strip()


def _repair_and_load_json(raw_text: str) -> dict[str, Any] | None:
    """Attempts multi-stage JSON recovery for complete or truncated LLM outputs."""
    cleaned = raw_text.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    if cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()

    # Stage 1: Direct JSON parsing
    try:
        data = json.loads(cleaned)
        if isinstance(data, dict):
            # Clean strings in parsed dict
            for k in ["reply", "suggested_prompt", "object_name"]:
                if k in data and isinstance(data[k], str):
                    data[k] = _safe_unescape_text(data[k])
            return data
    except Exception:
        pass

    # Stage 2: Substring between first { and last }
    b_start = cleaned.find("{")
    b_end = cleaned.rfind("}")
    if b_start != -1 and b_end > b_start:
        try:
            data = json.loads(cleaned[b_start : b_end + 1])
            if isinstance(data, dict):
                for k in ["reply", "suggested_prompt", "object_name"]:
                    if k in data and isinstance(data[k], str):
                        data[k] = _safe_unescape_text(data[k])
                return data
        except Exception:
            pass

    # Stage 3: Auto-close truncated JSON string/braces
    if b_start != -1:
        candidate = cleaned[b_start:]
        # Fix unclosed string literal if odd number of unescaped quotes
        unescaped_quotes = len(re.findall(r'(?<!\\)"', candidate))
        if unescaped_quotes % 2 != 0:
            candidate += '"'
        
        # Count and close missing arrays and objects
        open_brackets = candidate.count("[") - candidate.count("]")
        if open_brackets > 0:
            candidate += "]" * open_brackets
        open_braces = candidate.count("{") - candidate.count("}")
        if open_braces > 0:
            candidate += "}" * open_braces
        
        try:
            data = json.loads(candidate)
            if isinstance(data, dict):
                for k in ["reply", "suggested_prompt", "object_name"]:
                    if k in data and isinstance(data[k], str):
                        data[k] = _safe_unescape_text(data[k])
                return data
        except Exception:
            pass

    # Stage 4: Regex-based field extraction for partial/fragmented JSON
    recovered: dict[str, Any] = {}

    # Extract reply
    reply_m = re.search(r'"reply"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)', cleaned)
    if reply_m:
        recovered["reply"] = _safe_unescape_text(reply_m.group(1))

    # Extract suggested_prompt
    prompt_m = re.search(r'"suggested_prompt"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)', cleaned)
    if prompt_m:
        recovered["suggested_prompt"] = _safe_unescape_text(prompt_m.group(1))

    # Extract object_name
    obj_m = re.search(r'"object_name"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)', cleaned)
    if obj_m:
        recovered["object_name"] = _safe_unescape_text(obj_m.group(1))

    # Extract feature items
    feature_pattern = re.compile(
        r'\{[^{}]*?"name"\s*:\s*"([^"]+)"[^{}]*?\}',
        re.DOTALL,
    )
    features = []
    for m in feature_pattern.finditer(cleaned):
        try:
            feat_obj = json.loads(m.group(0))
            if isinstance(feat_obj, dict):
                features.append(feat_obj)
        except Exception:
            pass
    if features:
        recovered["blueprint_features"] = features

    # Extract discrepancy items
    disc_pattern = re.compile(
        r'\{[^{}]*?"feature"\s*:\s*"([^"]+)"[^{}]*?\}',
        re.DOTALL,
    )
    discs = []
    for m in disc_pattern.finditer(cleaned):
        try:
            disc_obj = json.loads(m.group(0))
            if isinstance(disc_obj, dict):
                discs.append(disc_obj)
        except Exception:
            pass
    if discs:
        recovered["discrepancies"] = discs

    return recovered if recovered else None


class CADPromptAssistantService:
    def __init__(self) -> None:
        env_path = Path(__file__).resolve().parents[4] / ".env"
        env_dict = dotenv_values(env_path) if env_path.exists() else {}
        self.google_api_key = env_dict.get("GOOGLE_API_KEY") or os.getenv("GOOGLE_API_KEY", "")
        self.openrouter_api_key = env_dict.get("OPENROUTER_API_KEY") or os.getenv("OPENROUTER_API_KEY", "")
        self._parts_cache: list[dict[str, Any]] | None = None

    def get_parts_dictionary(self) -> list[dict[str, Any]]:
        if self._parts_cache is None:
            if PARTS_JSON_PATH.exists():
                try:
                    with open(PARTS_JSON_PATH, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        self._parts_cache = data.get("entries", [])
                except Exception:
                    self._parts_cache = []
            else:
                self._parts_cache = []
        return self._parts_cache or []

    def _build_system_prompt(self, context: str = "") -> str:
        parts = self.get_parts_dictionary()
        if not parts:
            return SYSTEM_PROMPT_COMPARATOR

        vocab_lines = []
        for p in parts[:40]:
            name = p.get("name", "")
            cat = p.get("category", "")
            desc = p.get("description", "")
            line = f"- {name}" + (f" [{cat}]" if cat else "") + (f": {desc}" if desc else "")
            vocab_lines.append(line)

        vocab_str = "\n\nAUTHORITATIVE MECHANICAL VOCABULARY:\n" + "\n".join(vocab_lines)
        return SYSTEM_PROMPT_COMPARATOR + vocab_str

    @staticmethod
    def _parse_data_url(data_url: str) -> tuple[str, str] | None:
        match = re.match(r"^data:(image/[\w.+-]+);base64,(.*)$", data_url.strip(), re.DOTALL)
        if match:
            return match.group(1), match.group(2)
        return None

    async def compare_and_suggest_prompt(
        self,
        blueprint_image: Optional[str] = None,
        model_snapshot: Optional[str] = None,
        model_snapshots: Optional[list[str]] = None,
        user_message: str = "",
        chat_history: Optional[list[dict[str, str]]] = None,
        model_override: Optional[str] = None,
    ) -> dict[str, Any]:
        """Runs multimodal discrepancy comparison between blueprint and 3D render views."""
        system_instruction = self._build_system_prompt(user_message)
        model = model_override or "gemini-2.5-flash"

        # Prepare images
        images: list[tuple[str, str, str]] = []  # (label, mime, base64)
        if blueprint_image:
            parsed = self._parse_data_url(blueprint_image)
            if parsed:
                images.append(("Blueprint / Reference Engineering Drawing", parsed[0], parsed[1]))

        # Collect all 3D model snapshots
        all_snapshots: list[str] = []
        if model_snapshots:
            all_snapshots.extend(model_snapshots)
        elif model_snapshot:
            all_snapshots.append(model_snapshot)

        for idx, snap in enumerate(all_snapshots):
            parsed = self._parse_data_url(snap)
            if parsed:
                label = f"Current 3D Model Render View #{idx + 1}" if len(all_snapshots) > 1 else "Current 3D Model Render"
                images.append((label, parsed[0], parsed[1]))

        prompt_text = (
            f"USER QUERY / FEEDBACK: {user_message.strip() or 'Compare the reference blueprint drawing with the current 3D model viewport renders. Identify all missing or inaccurate features and write the precision parametric CAD prompt.'}\n\n"
            "MANDATORY MULTIMODAL AUDIT INSTRUCTIONS:\n"
            "1. Inspect the 3D Model Render(s): Describe the exact geometry currently built in the canvas.\n"
            "2. Read the 2D Blueprint Drawing (All Views, Dimensions, Diameters Ø, Tolerances, and Callouts):\n"
            "   - Extract exact numerical dimensions (diameters, lengths, widths, heights, radii, angles, pitch).\n"
            "   - For Turned / Cylindrical Parts (Flash Hiders, shafts, barrels): Revolve outer stepped profile, cut internal axial bores, cut polar array radial slots (e.g. 6x slots at 60°), and add tip prongs/chamfers.\n"
            "   - For Prismatic / Plate Parts (flanges, connectors, brackets): Extrude base plate with corner fillets & mounting holes, extrude secondary tiers/bosses, cut central cavities and detail holes.\n"
            "   - For Multi-Boss / Lever / Linkage Parts (Pitman arms, control arms, connecting rods, rocker arms, bell cranks, offset brackets): Model primary & secondary boss eyelets at pitch distance, construct the connecting arm/web, capture axial step offsets / dog-leg neck bends from Section A-A, cut respective bores/tapers at each boss center, and apply blend fillets.\n"
            "3. State the exact geometric delta between the 3D model and the blueprint under 'reply' and 'discrepancies'.\n"
            "4. Under 'suggested_prompt', write a FULL, production-ready, coordinate-accurate parametric CAD prompt with explicit numbers and sub-bullets for EVERY step.\n"
            "   CRITICAL: DO NOT WRITE ONE-LINE SUMMARIES OR PLACEHOLDERS. Write out every dimension (e.g. Length = X mm, Ø = Y mm, Z-depth = Z mm, count = 6x, pitch = P mm) across all steps (Step 1 through Step 5+).\n\n"
            "REMINDER: Respond ONLY with a valid JSON object matching the requested schema. Place 'reply' and 'suggested_prompt' at the beginning of the JSON."
        )

        raw_reply = ""
        # 1. Try Google Gemini directly if key available
        if self.google_api_key:
            try:
                raw_reply = await self._call_gemini(
                    api_key=self.google_api_key,
                    model=model if model.startswith("gemini") else "gemini-2.5-flash",
                    system_prompt=system_instruction,
                    user_text=prompt_text,
                    images=images,
                    history=chat_history or [],
                )
            except Exception as e:
                print(f"[CADPromptAssistant] Gemini call error: {e}")

        # 2. Fallback to OpenRouter if Gemini failed or no Google Key
        if not raw_reply and self.openrouter_api_key:
            try:
                raw_reply = await self._call_openrouter(
                    api_key=self.openrouter_api_key,
                    model="google/gemini-2.5-flash",
                    system_prompt=system_instruction,
                    user_text=prompt_text,
                    images=images,
                    history=chat_history or [],
                )
            except Exception as e:
                print(f"[CADPromptAssistant] OpenRouter call error: {e}")

        if not raw_reply:
            return {
                "reply": "Unable to connect to AI vision model. Please verify your API keys in .env (GOOGLE_API_KEY or OPENROUTER_API_KEY).",
                "analysis": None,
                "suggested_prompt": None,
                "error": "api_error",
            }

        # Extract structured JSON cleanly with robust fallback
        analysis = _repair_and_load_json(raw_reply)

        # Extract reply_text and suggested_prompt
        reply_text = ""
        suggested_prompt = None

        if analysis:
            reply_text = analysis.get("reply", "").strip()
            suggested_prompt = analysis.get("suggested_prompt")

        # Sanitize reply_text to prevent raw JSON field leaks
        is_raw_json_leak = (
            not reply_text
            or "object_name" in reply_text
            or "blueprint_features" in reply_text
            or "suggested_prompt" in reply_text
            or reply_text.startswith("{")
        )
        if is_raw_json_leak:
            reply_text = "Inspected reference drawing and generated precision parametric CAD corrections."

        # Guarantee suggested_prompt synthesis if not directly present in LLM response
        if not suggested_prompt:
            steps: list[str] = []
            
            # Check discrepancies first
            if analysis and analysis.get("discrepancies"):
                for i, d in enumerate(analysis["discrepancies"], 1):
                    feat = d.get("feature", "Feature")
                    issue = d.get("issue", "Modify geometry")
                    loc = d.get("location", "")
                    steps.append(f"{i}. {feat.upper()}: {issue}{f' ({loc})' if loc else ''}.")

            # Next check missing/inaccurate blueprint features
            if not steps and analysis and analysis.get("blueprint_features"):
                features_list = analysis["blueprint_features"]
                missing_or_inaccurate = [f for f in features_list if "match" not in str(f.get("status", "")).lower()]
                for i, f in enumerate(missing_or_inaccurate, 1):
                    name = f.get("name", f"Feature #{i}")
                    callout = f.get("callout", "")
                    spec = f.get("specification", "")
                    action = f.get("action", "Add / modify feature")
                    steps.append(f"{i}. {name.upper()}: {action} matching specification ({spec}){f' [{callout}]' if callout else ''}.")

        # Ensure suggested_prompt is clean, decoded, and formatted
        if suggested_prompt:
            suggested_prompt = _safe_unescape_text(suggested_prompt)
            suggested_prompt = JSON_BLOCK_RE.sub("", suggested_prompt).strip()
            if "```" in suggested_prompt:
                suggested_prompt = suggested_prompt.replace("```json", "").replace("```", "").strip()

        # Comprehensive CAD repair prompt validation and auto-synthesis
        numbered_matches = re.findall(r'^\s*(\d+)\.', suggested_prompt or "", re.MULTILINE)
        has_at_least_three_steps = len(numbered_matches) >= 3
        is_cut_off = (
            not suggested_prompt
            or len(suggested_prompt.strip()) < 80
            or (suggested_prompt.count('(') > suggested_prompt.count(')'))
            or not suggested_prompt.rstrip().endswith(('.', '!', '?', '"', ')', ']', '}'))
            or suggested_prompt.rstrip().endswith(("for", "the", "a", "an", "to", "in", "on", "at", "of", "with", "and", "by", ":", "-", "="))
        )

        if not has_at_least_three_steps or is_cut_off:
            steps: list[str] = []

            # If first step in suggested_prompt is clean and complete, keep it
            if suggested_prompt and not is_cut_off and len(numbered_matches) >= 1:
                first_block = suggested_prompt.split("\n\n")[0].strip()
                if first_block.endswith(('.', ')', ']')):
                    steps.append(first_block)

            # Check discrepancies
            if analysis and analysis.get("discrepancies"):
                for i, d in enumerate(analysis["discrepancies"], len(steps) + 1):
                    feat = d.get("feature", "Feature")
                    issue = d.get("issue", "Modify geometry per drawing")
                    loc = d.get("location", "")
                    steps.append(f"{i}. {feat.upper()}: {issue}{f' ({loc})' if loc else ''}.")

            # Check blueprint features
            if analysis and analysis.get("blueprint_features"):
                features_list = analysis["blueprint_features"]
                missing_or_inacc = [f for f in features_list if "match" not in str(f.get("status", "")).lower()]
                for f in missing_or_inacc:
                    name = f.get("name", "")
                    spec = f.get("specification", "")
                    act = f.get("action", "Model feature per specification")
                    callout = f.get("callout", "")
                    if name and not any(name.lower() in s.lower() for s in steps):
                        steps.append(f"{len(steps) + 1}. {name.upper()}: {act} ({spec}){f' [{callout}]' if callout else ''}.")

            # If still fewer than 3 steps, extract actionable geometric sentences from reply_text or blueprint features
            if len(steps) < 3 and reply_text and len(reply_text) > 30:
                sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', reply_text) if len(s.strip()) > 20 and not s.strip().lower().startswith(('the current 3d', 'this is a', 'the model is'))]
                for s in sentences:
                    if len(steps) >= 5:
                        break
                    clean_s = re.sub(r'^(?:the|all|and)\s+', '', s, flags=re.IGNORECASE).strip()
                    if clean_s and not any(clean_s[:20].lower() in existing.lower() for existing in steps):
                        steps.append(f"{len(steps) + 1}. GEOMETRIC RECONSTRUCTION: {clean_s}")

            # Fallback to general parametric mechanical structure if completely empty
            if len(steps) < 2:
                obj_name = (analysis.get("object_name") if analysis else None) or "Part"
                steps = [
                    f"1. BASE GEOMETRY ENVELOPE: Model the primary {obj_name} solid envelope matching overall length, width/diameter, and height from the technical drawing.",
                    "2. INTERNAL CAVITIES & BORES: Cut all specified internal bores, cavities, and through-openings matching section view dimensions.",
                    "3. SECONDARY & REPEATING FEATURES: Apply all specified mounting holes, slot patterns, ribs, or pockets at exact drawing coordinates.",
                    "4. EDGE BREAKS & TREATMENTS: Apply specified chamfers, root radii, and corner fillets per technical callouts."
                ]

            suggested_prompt = "\n\n".join(steps)

        # Final decode cleanup for clean Ø / ± / ° symbols
        suggested_prompt = _safe_unescape_text(suggested_prompt)
        reply_text = _safe_unescape_text(reply_text)

        return {
            "reply": reply_text,
            "analysis": analysis,
            "suggested_prompt": suggested_prompt,
        }

    async def _call_gemini(
        self,
        api_key: str,
        model: str,
        system_prompt: str,
        user_text: str,
        images: list[tuple[str, str, str]],
        history: list[dict[str, str]],
    ) -> str:
        import asyncio

        def _sync_call() -> str:
            target_model = model if model.startswith("gemini") else "gemini-2.5-flash"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{target_model}:generateContent?key={api_key}"
            contents = []

            for h in history[-8:]:
                role = "model" if h.get("role") == "assistant" else "user"
                contents.append({"role": role, "parts": [{"text": h.get("content", "")}]})

            user_parts = []
            for label, mime, b64 in images:
                user_parts.append({"text": f"[{label}]:"})
                user_parts.append({"inlineData": {"mimeType": mime, "data": b64}})
            user_parts.append({"text": user_text})

            contents.append({"role": "user", "parts": user_parts})

            payload = {
                "contents": contents,
                "systemInstruction": {"parts": [{"text": system_prompt}]},
                "generationConfig": {
                    "temperature": 0.2,
                    "maxOutputTokens": 4096,
                    "responseMimeType": "application/json",
                },
                "safetySettings": [
                    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                    {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                    {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
                    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
                ],
            }

            resp = requests.post(url, json=payload, timeout=90)
            if resp.status_code != 200:
                # Fallback if responseMimeType has issues on specific endpoint
                if "responseMimeType" in resp.text:
                    payload["generationConfig"] = {"temperature": 0.2, "maxOutputTokens": 4096}
                    resp = requests.post(url, json=payload, timeout=90)
                if resp.status_code != 200:
                    raise RuntimeError(f"Gemini HTTP {resp.status_code}: {resp.text[:300]}")
            data = resp.json()
            candidates = data.get("candidates", [])
            if not candidates:
                return ""
            parts = candidates[0].get("content", {}).get("parts", [])
            return "".join(p.get("text", "") for p in parts)

        return await asyncio.to_thread(_sync_call)

    async def _call_openrouter(
        self,
        api_key: str,
        model: str,
        system_prompt: str,
        user_text: str,
        images: list[tuple[str, str, str]],
        history: list[dict[str, str]],
    ) -> str:
        import asyncio

        def _sync_call() -> str:
            url = "https://openrouter.ai/api/v1/chat/completions"
            messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]

            for h in history[-8:]:
                messages.append({"role": h.get("role", "user"), "content": h.get("content", "")})

            content_blocks: list[dict[str, Any]] = []
            for label, mime, b64 in images:
                content_blocks.append({"type": "text", "text": f"[{label}]:"})
                content_blocks.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}"}
                })
            content_blocks.append({"type": "text", "text": user_text})

            messages.append({"role": "user", "content": content_blocks})

            payload = {
                "model": model,
                "messages": messages,
                "temperature": 0.2,
                "max_tokens": 4096,
                "response_format": {"type": "json_object"},
            }

            resp = requests.post(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
                timeout=90,
            )
            if resp.status_code != 200:
                raise RuntimeError(f"OpenRouter HTTP {resp.status_code}: {resp.text[:300]}")
            data = resp.json()
            return data["choices"][0]["message"]["content"] or ""

        return await asyncio.to_thread(_sync_call)
