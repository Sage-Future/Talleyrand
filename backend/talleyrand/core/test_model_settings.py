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
    # The API-key presets run on the matching agent: GPT on Hermes, Claude on
    # Claude Code.
    assert resolve_model_id("gpt-6-astra-medium") == "hermes-gpt-6-astra"
    assert resolve_model_id("claude-fable-5-1-max") == "claude-code-fable-5-1"
    assert resolve_model_id("claude-code") == "claude-code-sonnet-5-5"


def test_a_retired_replacement_is_skipped_over_not_chained():
    # Resolution is a single lookup, so an id retired in an earlier bump must
    # point straight at today's model, not at the model that replaced it then.
    assert resolve_model_id("gpt-5.5-medium") == "hermes-gpt-6-astra"
    assert resolve_model_id("claude-opus-4-8-xhigh") == "claude-code-fable-5-1"


def test_a_case_answered_by_a_retired_model_still_runs():
    config = get_model_config("gpt-5.4-nano-2026-03-17")
    assert config.id == "hermes-gpt-6-luna"
    assert (config.provider, config.agent_model) == ("hermes", "gpt-6-luna")


def test_unknown_model_is_an_error_rather_than_a_guess():
    with pytest.raises(ValueError, match="Unknown model 'gpt-imaginary'"):
        resolve_model_id("gpt-imaginary")


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
