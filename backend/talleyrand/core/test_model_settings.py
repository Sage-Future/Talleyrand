"""
Tests for the model retirement map.

Cases outlive the models that answered them, so every id the app has ever
stored must still resolve to something runnable. These tests guard the two ways
that breaks: a retired id pointing at a replacement that itself got retired, and
a retired id lingering in the current list.
"""

import pytest

from talleyrand.core.model_settings import (
    MODEL_CONFIGS,
    RETIRED_MODELS,
    get_model_config,
    resolve_model_id,
)


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
    assert fallback_ids == {
        "claude-fable-5-1-medium",
        "claude-fable-5-1-high",
        "claude-fable-5-1-max",
    }
