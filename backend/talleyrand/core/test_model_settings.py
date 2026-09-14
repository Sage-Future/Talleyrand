"""
Tests for the model retirement map.

Cases outlive the models that answered them, so every id the app has ever
stored must still resolve to something runnable. These tests guard the two ways
that breaks: a retired id pointing at a replacement that itself got retired, and
a retired id lingering in the current list.
"""

import re
from pathlib import Path

import pytest

from talleyrand.core.model_settings import (
    ANTHROPIC_MAX_OUTPUT_TOKENS,
    MODEL_CONFIGS,
    MODEL_WINDOWS,
    RETIRED_MODELS,
    get_model_config,
    get_model_window,
    resolve_model_id,
)

# The frontend keeps its own copy of each preset's input limit for the context
# meter; it lives alongside the backend in the repository.
FRONTEND_MODELS = Path(__file__).resolve().parents[3] / "frontend" / "src" / "config" / "models.ts"

FABLE_5_1_IDS = {"claude-fable-5-1-medium", "claude-fable-5-1-high", "claude-fable-5-1-max"}


def test_every_retired_model_points_at_a_current_one():
    for retired_id, replacement in RETIRED_MODELS.items():
        assert replacement in MODEL_CONFIGS, (
            f"'{retired_id}' is replaced by '{replacement}', which no longer exists"
        )


def test_no_model_is_both_current_and_retired():
    assert not set(RETIRED_MODELS) & set(MODEL_CONFIGS)


def test_current_ids_resolve_to_themselves():
    for model_id in MODEL_CONFIGS:
        assert resolve_model_id(model_id) == model_id


def test_retired_ids_resolve_to_their_replacement():
    assert resolve_model_id("gpt-5.6-sol-medium") == "gpt-6-astra-medium"
    assert resolve_model_id("claude-opus-5-max") == "claude-fable-5-1-max"


def test_a_retired_replacement_is_skipped_over_not_chained():
    # Resolution is a single lookup, so an id retired in an earlier bump must
    # point straight at today's model, not at the model that replaced it then.
    assert resolve_model_id("gpt-5.5-medium") == "gpt-6-astra-medium"
    assert resolve_model_id("claude-opus-4-8-xhigh") == "claude-fable-5-1-max"


def test_a_case_answered_by_a_retired_model_still_runs():
    config = get_model_config("gpt-5.4-nano-2026-03-17")
    assert config.id == "gpt-5.6-luna"
    assert config.api_model == "gpt-5.6-luna"


def test_unknown_model_is_an_error_rather_than_a_guess():
    with pytest.raises(ValueError, match="Unknown model 'gpt-imaginary'"):
        resolve_model_id("gpt-imaginary")


def test_reasoning_effort_none_is_explicit_not_absent():
    # "none" is a real GPT-5.6 effort level; dropping it to None would silently
    # give Luna the API default (medium) instead of no reasoning at all.
    assert MODEL_CONFIGS["gpt-5.6-luna"].reasoning_effort == "none"
    # Haiku rejects the effort parameter outright, so it must stay absent.
    assert MODEL_CONFIGS["claude-haiku-4-5"].reasoning_effort is None


def test_only_fable_5_1_opts_into_the_refusal_fallback():
    fallback_ids = {m.id for m in MODEL_CONFIGS.values() if m.refusal_fallback}
    assert fallback_ids == FABLE_5_1_IDS


def test_only_fable_5_1_is_asked_for_plain_prose():
    plain_prose_ids = {m.id for m in MODEL_CONFIGS.values() if m.plain_prose}
    assert plain_prose_ids == FABLE_5_1_IDS


def test_every_preset_runs_on_a_model_with_a_recorded_window():
    for config in MODEL_CONFIGS.values():
        assert config.window.api_model == config.api_model
        assert config.provider == config.window.provider


def test_an_unknown_api_model_has_no_window():
    with pytest.raises(ValueError, match="No context window recorded for 'gpt-imaginary'"):
        get_model_window("gpt-imaginary")


def test_no_input_limit_exceeds_its_window():
    for window in MODEL_WINDOWS.values():
        assert 0 < window.max_input_tokens <= window.context_tokens
        assert 0 < window.max_output_tokens <= window.context_tokens


def test_openai_input_limit_is_the_window_less_the_output_ceiling():
    # OpenAI publishes the input ceiling separately (922,000 for the 1,050,000
    # windows); it is enforced whatever output a request asks for.
    for window in MODEL_WINDOWS.values():
        if window.provider == "openai":
            assert window.max_input_tokens == window.context_tokens - window.max_output_tokens


def test_anthropic_input_limit_leaves_room_for_the_output_budget():
    # Anthropic requires an output budget on every request and takes it out of
    # the same window, so the input limit is what is left after our budget.
    for window in MODEL_WINDOWS.values():
        if window.provider == "anthropic":
            assert window.max_output_tokens >= ANTHROPIC_MAX_OUTPUT_TOKENS
            assert window.max_input_tokens == window.context_tokens - ANTHROPIC_MAX_OUTPUT_TOKENS


def test_frontend_mirrors_each_presets_input_limit():
    if not FRONTEND_MODELS.exists():
        pytest.skip("frontend is not checked out next to the backend")
    source = FRONTEND_MODELS.read_text()
    mirrored = {
        preset_id: int(tokens)
        for preset_id, tokens in re.findall(r"id: '([^']+)'[^}]*?inputTokens: (\d+)", source)
    }
    assert mirrored == {
        preset_id: config.max_input_tokens for preset_id, config in MODEL_CONFIGS.items()
    }
