from dataclasses import dataclass
from typing import Literal, cast

type SupportedModel = Literal[
    "gpt-5.6-luna",
    "gpt-5.6-terra",
    "gpt-5.6-sol-medium",
    "gpt-5.6-sol-high",
    "gpt-5.6-sol-max",
    "claude-haiku-4-5",
    "claude-sonnet-5",
    "claude-opus-5-medium",
    "claude-opus-5-high",
    "claude-opus-5-max",
]

type Provider = Literal["openai", "anthropic"]

# "none" is an explicit GPT-5.6 effort level meaning "do not reason at all" —
# distinct from reasoning_effort=None, which means "send no effort parameter"
# (the right thing for Claude Haiku, which rejects the parameter outright).
type ReasoningEffort = Literal["none", "low", "medium", "high", "xhigh", "max"]


@dataclass
class ModelConfig:
    """
    Configuration class for AI model settings.

    Attributes:
        id (SupportedModel): Unique preset identifier used in the UI and config lookups.
        provider (Provider): LLM provider the model belongs to.
        api_model (str): The actual model name sent to the provider's API.
        label (str): Human-readable display name for the model.
        description (str): Detailed description of the model's capabilities and use cases.
        order (int): Sort order for displaying models in user interfaces.
        context_tokens (int): Maximum number of tokens the model can process in its context window.
        reasoning_effort: Level of computational effort the model applies to reasoning tasks.
        refusal_fallback: Whether to let Anthropic re-run a refused request on a stand-in
            model. Only set for models whose safety classifiers can decline a request
            outright; the substitution is announced in the answer (see core/llm.py).
    """

    id: SupportedModel
    provider: Provider
    api_model: str
    label: str
    description: str
    order: int
    context_tokens: int
    reasoning_effort: ReasoningEffort | None
    refusal_fallback: bool = False


MODEL_CONFIGS: dict[SupportedModel, ModelConfig] = {
    "gpt-5.6-luna": ModelConfig(
        id="gpt-5.6-luna",
        provider="openai",
        api_model="gpt-5.6-luna",
        label="GPT-5.6 Luna",
        description="Fastest, most economical",
        order=1,
        context_tokens=1050000,
        reasoning_effort="none",
    ),
    "gpt-5.6-terra": ModelConfig(
        id="gpt-5.6-terra",
        provider="openai",
        api_model="gpt-5.6-terra",
        label="GPT-5.6 Terra",
        description="Balanced performance",
        order=2,
        context_tokens=1050000,
        reasoning_effort="medium",
    ),
    "gpt-5.6-sol-medium": ModelConfig(
        id="gpt-5.6-sol-medium",
        provider="openai",
        api_model="gpt-5.6-sol",
        label="GPT-5.6 Sol medium",
        description="Most capable",
        order=3,
        context_tokens=1050000,
        reasoning_effort="medium",
    ),
    "gpt-5.6-sol-high": ModelConfig(
        id="gpt-5.6-sol-high",
        provider="openai",
        api_model="gpt-5.6-sol",
        label="GPT-5.6 Sol high",
        description="High-quality reasoning",
        order=4,
        context_tokens=1050000,
        reasoning_effort="high",
    ),
    "gpt-5.6-sol-max": ModelConfig(
        id="gpt-5.6-sol-max",
        provider="openai",
        api_model="gpt-5.6-sol",
        label="GPT-5.6 Sol max",
        description="Deepest reasoning (max)",
        order=5,
        context_tokens=1050000,
        reasoning_effort="max",
    ),
    "claude-haiku-4-5": ModelConfig(
        id="claude-haiku-4-5",
        provider="anthropic",
        api_model="claude-haiku-4-5",
        label="Claude Haiku 4.5",
        description="Fastest Claude",
        order=6,
        context_tokens=200000,
        reasoning_effort=None,
    ),
    "claude-sonnet-5": ModelConfig(
        id="claude-sonnet-5",
        provider="anthropic",
        api_model="claude-sonnet-5",
        label="Claude Sonnet 5",
        description="Balanced Claude",
        order=7,
        context_tokens=1000000,
        reasoning_effort="medium",
    ),
    "claude-opus-5-medium": ModelConfig(
        id="claude-opus-5-medium",
        provider="anthropic",
        api_model="claude-opus-5",
        label="Claude Opus 5 medium",
        description="Most capable Claude",
        order=8,
        context_tokens=1000000,
        reasoning_effort="medium",
        refusal_fallback=True,
    ),
    "claude-opus-5-high": ModelConfig(
        id="claude-opus-5-high",
        provider="anthropic",
        api_model="claude-opus-5",
        label="Claude Opus 5 high",
        description="High-quality reasoning",
        order=9,
        context_tokens=1000000,
        reasoning_effort="high",
        refusal_fallback=True,
    ),
    "claude-opus-5-max": ModelConfig(
        id="claude-opus-5-max",
        provider="anthropic",
        api_model="claude-opus-5",
        label="Claude Opus 5 max",
        description="Deepest reasoning (max)",
        order=10,
        context_tokens=1000000,
        reasoning_effort="max",
        refusal_fallback=True,
    ),
}

# Presets we have removed, each pointing at its closest current replacement.
#
# A case records the model that answered each question, so cases outlive the
# models they were built with. Rather than rewriting stored cases on every
# model bump, retired ids are translated here at read time: the old id stays on
# disk as an honest record of what produced the answer, and any new work on
# that question runs on the replacement.
#
# When retiring a model: delete its entry from MODEL_CONFIGS and add one line
# here pointing at whatever replaces it. Entries are never removed — an id that
# is neither current nor listed here is a genuine bug, not something to guess at.
RETIRED_MODELS: dict[str, SupportedModel] = {
    # Retired 2026-08-18, replaced by the GPT-5.6 family
    "gpt-5.4-nano-2026-03-17": "gpt-5.6-luna",
    "gpt-5.4-mini-2026-03-17": "gpt-5.6-terra",
    "gpt-5.5-medium": "gpt-5.6-sol-medium",
    "gpt-5.5-high": "gpt-5.6-sol-high",
    "gpt-5.5-xhigh": "gpt-5.6-sol-max",
    # Retired 2026-08-18, replaced by Claude 5
    "claude-sonnet-4-6": "claude-sonnet-5",
    "claude-opus-4-8-medium": "claude-opus-5-medium",
    "claude-opus-4-8-high": "claude-opus-5-high",
    "claude-opus-4-8-xhigh": "claude-opus-5-max",
}


def resolve_model_id(model_id: str) -> SupportedModel:
    """Current preset for a stored id, translating retired ids to replacements."""
    if model_id in MODEL_CONFIGS:
        return cast(SupportedModel, model_id)
    replacement = RETIRED_MODELS.get(model_id)
    if replacement is None:
        available = ", ".join(MODEL_CONFIGS)
        raise ValueError(f"Unknown model '{model_id}'. Current models: {available}")
    return replacement


def get_model_config(model_id: str) -> ModelConfig:
    return MODEL_CONFIGS[resolve_model_id(model_id)]
