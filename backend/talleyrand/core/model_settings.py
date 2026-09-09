from dataclasses import dataclass
from typing import Literal, cast

type SupportedModel = Literal[
    "gpt-5.6-luna",
    "gpt-5.6-terra",
    "gpt-6-astra-medium",
    "gpt-6-astra-high",
    "gpt-6-astra-max",
    "claude-haiku-4-5",
    "claude-sonnet-5",
    "claude-fable-5-1-medium",
    "claude-fable-5-1-high",
    "claude-fable-5-1-max",
]

type Provider = Literal["openai", "anthropic"]

# "none" is an explicit GPT-5.6 effort level meaning "do not reason at all" —
# distinct from reasoning_effort=None, which means "send no effort parameter"
# (the right thing for Claude Haiku, which rejects the parameter outright).
# GPT-6 Astra does not accept "none": its ladder starts at "low".
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
    "gpt-6-astra-medium": ModelConfig(
        id="gpt-6-astra-medium",
        provider="openai",
        api_model="gpt-6-astra",
        label="GPT-6 Astra medium",
        description="Most capable",
        order=3,
        context_tokens=1050000,
        reasoning_effort="medium",
    ),
    "gpt-6-astra-high": ModelConfig(
        id="gpt-6-astra-high",
        provider="openai",
        api_model="gpt-6-astra",
        label="GPT-6 Astra high",
        description="High-quality reasoning",
        order=4,
        context_tokens=1050000,
        reasoning_effort="high",
    ),
    "gpt-6-astra-max": ModelConfig(
        id="gpt-6-astra-max",
        provider="openai",
        api_model="gpt-6-astra",
        label="GPT-6 Astra max",
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
    "claude-fable-5-1-medium": ModelConfig(
        id="claude-fable-5-1-medium",
        provider="anthropic",
        api_model="claude-fable-5-1",
        label="Claude Fable 5.1 medium",
        description="Most capable Claude",
        order=8,
        context_tokens=1000000,
        reasoning_effort="medium",
        refusal_fallback=True,
    ),
    "claude-fable-5-1-high": ModelConfig(
        id="claude-fable-5-1-high",
        provider="anthropic",
        api_model="claude-fable-5-1",
        label="Claude Fable 5.1 high",
        description="High-quality reasoning",
        order=9,
        context_tokens=1000000,
        reasoning_effort="high",
        refusal_fallback=True,
    ),
    "claude-fable-5-1-max": ModelConfig(
        id="claude-fable-5-1-max",
        provider="anthropic",
        api_model="claude-fable-5-1",
        label="Claude Fable 5.1 max",
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
# The map is one hop deep: when a replacement is itself retired, every entry
# that pointed at it is re-pointed at the new replacement.
RETIRED_MODELS: dict[str, SupportedModel] = {
    # Retired 2026-08-18 for the GPT-5.6 family, whose Sol tier has since
    # given way to GPT-6 Astra
    "gpt-5.4-nano-2026-03-17": "gpt-5.6-luna",
    "gpt-5.4-mini-2026-03-17": "gpt-5.6-terra",
    "gpt-5.5-medium": "gpt-6-astra-medium",
    "gpt-5.5-high": "gpt-6-astra-high",
    "gpt-5.5-xhigh": "gpt-6-astra-max",
    # Retired 2026-08-18 for Claude 5, whose Opus tier has since given way to
    # Claude Fable 5.1
    "claude-sonnet-4-6": "claude-sonnet-5",
    "claude-opus-4-8-medium": "claude-fable-5-1-medium",
    "claude-opus-4-8-high": "claude-fable-5-1-high",
    "claude-opus-4-8-xhigh": "claude-fable-5-1-max",
    # Retired 2026-09-09, replaced by GPT-6 Astra
    "gpt-5.6-sol-medium": "gpt-6-astra-medium",
    "gpt-5.6-sol-high": "gpt-6-astra-high",
    "gpt-5.6-sol-max": "gpt-6-astra-max",
    # Retired 2026-09-09, replaced by Claude Fable 5.1
    "claude-opus-5-medium": "claude-fable-5-1-medium",
    "claude-opus-5-high": "claude-fable-5-1-high",
    "claude-opus-5-max": "claude-fable-5-1-max",
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
