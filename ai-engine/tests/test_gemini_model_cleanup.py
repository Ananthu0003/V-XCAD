"""
Regression tests for the Gemini model-configuration cleanup.

Goal being verified: legacy gemini-2.5-flash / gemini-2.5-pro (and any Gemini 2.x model)
must no longer be reachable as an active default/fallback/allowlist entry, replaced with
Gemini 3+ Flash-family models only (no Pro, no image/audio/TTS models).

CADPromptAssistantService's Gemini calls go through raw `requests.post()` (no SDK
dependency), so these tests exercise the REAL service methods end-to-end via `asyncio.run`
(pytest-asyncio is not part of this project's test setup), intercepting only the outbound
HTTP call — not a reimplementation of the model-selection logic.
"""
import asyncio
import os
import sys
import unittest.mock as mock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.agents.cad_prompt_assistant import (
    ALLOWED_GEMINI_MODELS,
    DEFAULT_GEMINI_MODEL,
    CADPromptAssistantService,
)

BANNED_MODELS = {
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-pro",
}


def run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# 1/2. Static allowlist/default checks
# ---------------------------------------------------------------------------

class TestAllowlistExcludesLegacyModels:
    def test_no_gemini_2x_model_in_allowlist(self):
        for banned in BANNED_MODELS:
            assert banned not in ALLOWED_GEMINI_MODELS, f"{banned} must not be an allowed model"

    def test_no_gemini_2x_prefix_in_allowlist(self):
        assert not any(m.startswith("gemini-2") for m in ALLOWED_GEMINI_MODELS)

    def test_no_pro_model_in_allowlist(self):
        assert not any("pro" in m for m in ALLOWED_GEMINI_MODELS), "no Gemini Pro model may be allowed"

    def test_no_image_audio_tts_model_in_allowlist(self):
        forbidden_substrings = ("image", "audio", "tts", "vision-only")
        for m in ALLOWED_GEMINI_MODELS:
            assert not any(s in m for s in forbidden_substrings), f"{m} looks like a non-text model"

    def test_default_is_the_preferred_lightweight_model(self):
        assert DEFAULT_GEMINI_MODEL == "gemini-3.5-flash-lite"
        assert DEFAULT_GEMINI_MODEL in ALLOWED_GEMINI_MODELS

    def test_preferred_stronger_fallback_is_allowed(self):
        assert "gemini-3.5-flash" in ALLOWED_GEMINI_MODELS

    def test_allowlist_is_flash_family_only(self):
        # Every entry must be recognizably Gemini 3+ and Flash-tier (Flash or Flash-Lite).
        for m in ALLOWED_GEMINI_MODELS:
            assert m.startswith("gemini-3"), f"{m} is not Gemini 3+"
            assert "flash" in m, f"{m} is not a Flash-family model"

    def test_gemini_3_8_flash_is_allowed(self):
        assert "gemini-3.8-flash" in ALLOWED_GEMINI_MODELS

    def test_gemini_3_1_flash_lite_removed_no_concrete_runtime_dependency(self):
        # This assistant never receives a caller-selected model in practice
        # (PromptAssistantWidget.tsx sends no `model` field), and gemini-3.1-flash-lite is
        # not used as a default/fallback anywhere in this module or google.py's fallback
        # chain, so it was removed from this specific allowlist. It remains untouched in
        # the unrelated model registries (registry.py / models-registry.ts).
        assert "gemini-3.1-flash-lite" not in ALLOWED_GEMINI_MODELS

    def test_allowlist_matches_exact_expected_set(self):
        assert ALLOWED_GEMINI_MODELS == {
            "gemini-3.5-flash-lite",
            "gemini-3.5-flash",
            "gemini-3.6-flash",
            "gemini-3.7-flash",
            "gemini-3.8-flash",
        }


# ---------------------------------------------------------------------------
# Test harness: intercept requests.post and inspect the requested model
# ---------------------------------------------------------------------------

def _fake_gemini_response():
    resp = mock.Mock()
    resp.status_code = 200
    resp.json.return_value = {
        "candidates": [{"content": {"parts": [{"text": '{"reply": "ok", "suggested_prompt": null}'}]}}]
    }
    resp.text = "{}"
    return resp


def _fake_openrouter_response():
    resp = mock.Mock()
    resp.status_code = 200
    resp.json.return_value = {"choices": [{"message": {"content": '{"reply": "ok", "suggested_prompt": null}'}}]}
    resp.text = "{}"
    return resp


def _service(google_key="fake-google-key", openrouter_key="fake-openrouter-key"):
    svc = CADPromptAssistantService.__new__(CADPromptAssistantService)
    svc.google_api_key = google_key
    svc.openrouter_api_key = openrouter_key
    svc._parts_cache = []
    return svc


def _extract_model_from_gemini_url(call_args) -> str:
    """The Gemini REST URL embeds the model: .../models/{model}:generateContent?key=..."""
    url = call_args[0][0]
    assert "/models/" in url
    return url.split("/models/", 1)[1].split(":", 1)[0]


# ---------------------------------------------------------------------------
# 3. Lightweight/default fallback accepted
# ---------------------------------------------------------------------------

class TestDefaultModelSelection:
    def test_no_override_uses_the_default_lightweight_model(self):
        svc = _service()
        with mock.patch("app.services.agents.cad_prompt_assistant.requests.post", return_value=_fake_gemini_response()) as post:
            run(svc.compare_and_suggest_prompt(user_message="test", model_override=None))
        used_model = _extract_model_from_gemini_url(post.call_args)
        assert used_model == DEFAULT_GEMINI_MODEL == "gemini-3.5-flash-lite"


# ---------------------------------------------------------------------------
# 4. Stronger Flash fallback accepted (a legitimate non-default Gemini 3+ override)
# ---------------------------------------------------------------------------

class TestValidOverrideIsRespected:
    def test_valid_gemini3_override_is_used_as_is(self):
        svc = _service()
        with mock.patch("app.services.agents.cad_prompt_assistant.requests.post", return_value=_fake_gemini_response()) as post:
            run(svc.compare_and_suggest_prompt(user_message="test", model_override="gemini-3.7-flash"))
        used_model = _extract_model_from_gemini_url(post.call_args)
        assert used_model == "gemini-3.7-flash"

    def test_stronger_flash_fallback_model_is_individually_usable(self):
        svc = _service()
        with mock.patch("app.services.agents.cad_prompt_assistant.requests.post", return_value=_fake_gemini_response()) as post:
            run(svc.compare_and_suggest_prompt(user_message="test", model_override="gemini-3.5-flash"))
        used_model = _extract_model_from_gemini_url(post.call_args)
        assert used_model == "gemini-3.5-flash"

    def test_gemini_3_8_flash_override_is_used_as_is(self):
        svc = _service()
        with mock.patch("app.services.agents.cad_prompt_assistant.requests.post", return_value=_fake_gemini_response()) as post:
            run(svc.compare_and_suggest_prompt(user_message="test", model_override="gemini-3.8-flash"))
        used_model = _extract_model_from_gemini_url(post.call_args)
        assert used_model == "gemini-3.8-flash"

    def test_gemini_3_1_flash_lite_override_now_falls_back_to_default(self):
        """gemini-3.1-flash-lite was removed from this allowlist (no concrete runtime
        dependency on it here), so a caller requesting it must now fall back to the
        default — same treatment as any other model not in ALLOWED_GEMINI_MODELS."""
        svc = _service()
        with mock.patch("app.services.agents.cad_prompt_assistant.requests.post", return_value=_fake_gemini_response()) as post:
            run(svc.compare_and_suggest_prompt(user_message="test", model_override="gemini-3.1-flash-lite"))
        used_model = _extract_model_from_gemini_url(post.call_args)
        assert used_model == DEFAULT_GEMINI_MODEL


# ---------------------------------------------------------------------------
# 5. A Gemini 2.x model cannot be selected through the normal fallback path,
#    even via caller-supplied model_override (the original vulnerability class).
# ---------------------------------------------------------------------------

class TestLegacyModelCannotBeSelected:
    def test_legacy_model_override_falls_back_to_default(self):
        for legacy_model in sorted(BANNED_MODELS):
            svc = _service()
            with mock.patch("app.services.agents.cad_prompt_assistant.requests.post", return_value=_fake_gemini_response()) as post:
                run(svc.compare_and_suggest_prompt(user_message="test", model_override=legacy_model))
            used_model = _extract_model_from_gemini_url(post.call_args)
            assert used_model != legacy_model, f"{legacy_model} must not reach the API"
            assert used_model == DEFAULT_GEMINI_MODEL
            assert used_model in ALLOWED_GEMINI_MODELS

    def test_non_gemini_override_falls_back_to_default(self):
        """Sanity: a non-Gemini override (e.g. a chat-model id from another vendor) must
        still resolve to a safe Gemini default for the Gemini-specific call, unchanged
        from prior (pre-cleanup) behavior other than which model it lands on."""
        svc = _service()
        with mock.patch("app.services.agents.cad_prompt_assistant.requests.post", return_value=_fake_gemini_response()) as post:
            run(svc.compare_and_suggest_prompt(user_message="test", model_override="anthropic/claude-sonnet-5"))
        used_model = _extract_model_from_gemini_url(post.call_args)
        assert used_model == DEFAULT_GEMINI_MODEL


# ---------------------------------------------------------------------------
# OpenRouter fallback path: also Gemini 3+, plays the "stronger fallback" role
# (it's the last-resort path when Gemini fails or no Google key is set).
# ---------------------------------------------------------------------------

class TestOpenRouterFallbackModel:
    def test_openrouter_fallback_uses_gemini3_not_legacy(self):
        svc = _service(google_key="")  # forces the OpenRouter path
        with mock.patch("app.services.agents.cad_prompt_assistant.requests.post", return_value=_fake_openrouter_response()) as post:
            run(svc.compare_and_suggest_prompt(user_message="test"))
        payload = post.call_args.kwargs["json"]
        assert payload["model"] == "google/gemini-3.5-flash"
        assert "gemini-2" not in payload["model"]


# ---------------------------------------------------------------------------
# 6. Existing behavior otherwise unchanged: no key configured still yields the
#    documented error response, not a crash.
# ---------------------------------------------------------------------------

class TestUnchangedErrorHandling:
    def test_no_api_keys_returns_documented_error(self):
        svc = _service(google_key="", openrouter_key="")
        result = run(svc.compare_and_suggest_prompt(user_message="test"))
        assert result["error"] == "api_error"
        assert result["analysis"] is None


# ---------------------------------------------------------------------------
# GoogleGateway (app/services/llm/gateways/google.py) fallback_candidates chain.
#
# The google-genai SDK is an optional dependency not installed in this sandbox
# (google.py already handles that: `genai`/`types` fall back to None at import time).
# Rather than skip coverage, these tests install lightweight fakes for exactly the SDK
# surface GoogleGateway touches (Part, ThinkingConfig, GenerateContentConfig, Client),
# then exercise the REAL generate()/generate_stream() fallback loop end-to-end —
# genuinely executing the candidate-selection logic, not reimplementing it.
# ---------------------------------------------------------------------------

import app.services.llm.gateways.google as google_module  # noqa: E402
from app.models.domain import ModelMetadata  # noqa: E402


class _FakePart:
    @staticmethod
    def from_bytes(data, mime_type):
        return {"kind": "bytes", "mime_type": mime_type}

    @staticmethod
    def from_text(text):
        return {"kind": "text", "text": text}


class _FakeThinkingConfig:
    def __init__(self, thinking_budget=None):
        self.thinking_budget = thinking_budget


class _FakeGenerateContentConfig:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class _FakeTypes:
    Part = _FakePart
    ThinkingConfig = _FakeThinkingConfig
    GenerateContentConfig = _FakeGenerateContentConfig


class _NotFoundError(Exception):
    pass


class _FakeModelsAPI:
    """Fails for every model name in `failing_models`, succeeds otherwise."""

    def __init__(self, failing_models: set[str]):
        self.failing_models = failing_models
        self.attempted_models: list[str] = []

    def generate_content(self, model, contents, config):
        self.attempted_models.append(model)
        if model in self.failing_models:
            raise _NotFoundError(f"404 model {model} not found")
        resp = mock.Mock()
        resp.text = f"ok from {model}"
        return resp

    def generate_content_stream(self, model, contents, config):
        self.attempted_models.append(model)
        if model in self.failing_models:
            raise _NotFoundError(f"404 model {model} not found")

        def _gen():
            chunk = mock.Mock()
            chunk.text = f"ok from {model}"
            yield chunk
        return _gen()


class _FakeClient:
    def __init__(self, api_key=None):
        self.models = None  # set by the test after construction


def _make_gateway(failing_models: set[str] = frozenset()):
    with mock.patch.object(google_module, "genai", mock.Mock(Client=_FakeClient)), \
         mock.patch.object(google_module, "types", _FakeTypes):
        gw = google_module.GoogleGateway(api_key="fake-key")
    fake_models = _FakeModelsAPI(failing_models)
    gw.client.models = fake_models
    return gw, fake_models


def _metadata(model_id="some-requested-model"):
    return ModelMetadata(
        id=model_id, name="test", vendor="google", tier="flash",
        maxTokens=100000, supportsThinking=True, description="test", badge="test",
    )


EXPECTED_FALLBACK_TAIL = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"]


class TestGoogleGatewayFallbackChain:
    def test_generate_fallback_chain_matches_exact_specified_order(self):
        with mock.patch.object(google_module, "types", _FakeTypes):
            gw, fake_models = _make_gateway(failing_models={"unreachable-requested-model", *EXPECTED_FALLBACK_TAIL[:-1]})
            result = run(gw.generate(prompt="hi", metadata=_metadata("unreachable-requested-model")))
        assert fake_models.attempted_models == ["unreachable-requested-model", *EXPECTED_FALLBACK_TAIL]
        assert not any(m.startswith("gemini-2") for m in fake_models.attempted_models)
        assert not any("pro" in m for m in fake_models.attempted_models)
        assert result == "ok from gemini-3.6-flash"

    def test_generate_stream_fallback_chain_matches_exact_specified_order(self):
        with mock.patch.object(google_module, "types", _FakeTypes):
            gw, fake_models = _make_gateway(failing_models={"unreachable-requested-model", *EXPECTED_FALLBACK_TAIL[:-1]})

            async def _drain():
                chunks = []
                async for c in gw.generate_stream(prompt="hi", metadata=_metadata("unreachable-requested-model")):
                    chunks.append(c)
                return chunks

            chunks = run(_drain())
        assert fake_models.attempted_models == ["unreachable-requested-model", *EXPECTED_FALLBACK_TAIL]
        assert not any(m.startswith("gemini-2") for m in fake_models.attempted_models)
        assert chunks == ["ok from gemini-3.6-flash"]

    def test_fallback_chain_is_exactly_five_distinct_gemini3_levels(self):
        with mock.patch.object(google_module, "types", _FakeTypes):
            gw, fake_models = _make_gateway(failing_models={"req", *EXPECTED_FALLBACK_TAIL})
            with pytest.raises(_NotFoundError):
                run(gw.generate(prompt="hi", metadata=_metadata("req")))
        assert len(fake_models.attempted_models) == 5
        assert len(set(fake_models.attempted_models)) == 5, "fallback levels must be distinct, not collapsed duplicates"
        for m in fake_models.attempted_models[1:]:  # skip the caller-requested model id
            assert m.startswith("gemini-3")
            assert "pro" not in m

    def test_gemini_3_1_flash_lite_is_not_in_the_fallback_chain(self):
        # Removed per the same "no concrete runtime dependency" reasoning applied to
        # cad_prompt_assistant.py's allowlist.
        assert "gemini-3.1-flash-lite" not in EXPECTED_FALLBACK_TAIL
