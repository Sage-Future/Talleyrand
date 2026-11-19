from dataclasses import dataclass
from typing import Literal, cast

type SupportedModel = Literal[
    "gpt-6-luna",
    "gpt-6.2-sol",
    "gpt-6.2-astra-medium",
    "gpt-6.2-astra-high",
    "gpt-6.2-astra-max",
    "claude-haiku-5-5",
    "claude-sonnet-5-5",
    "claude-fable-5-2-medium",
    "claude-fable-5-2-high",
    "claude-fable-5-2-max",
]

type Provider = Literal["openai", "anthropic"]

# "none" is an explicit GPT-6 Luna effort level meaning "do not reason at all".
# GPT-6.2 Sol and Astra reject it: their ladder starts at "low". Claude models
# take "low" through "max".
type ReasoningEffort = Literal["none", "low", "medium", "high", "xhigh", "max"]

# The output budget (max_tokens) every Anthropic request asks for. Anthropic
# requires one, and input and output share the window, so the budget comes off
# the input side of every Claude model's window. 64K fits under the output
# ceiling of every supported Claude model; asking for more would leave less
# room for the case.
ANTHROPIC_MAX_OUTPUT_TOKENS = 64_000


@dataclass(frozen=True)
class ModelWindow:
    """
    How much one API model reads and writes, per the provider's published limits.

    Attributes:
        provider: LLM provider serving the model.
        api_model: The model name sent to the provider's API.
        context_tokens: The window that input and output share.
        max_output_tokens: The most the model may write in one response.
        max_input_tokens: The most a request may carry; the provider rejects
            anything larger. For OpenAI this is the published input ceiling,
            enforced whatever output the request asks for. For Anthropic it is
            the window less ANTHROPIC_MAX_OUTPUT_TOKENS, the output budget every
            request here reserves.
    """

    provider: Provider
    api_model: str
    context_tokens: int
    max_output_tokens: int
    max_input_tokens: int


def _openai_window(
    api_model: str, *, context_tokens: int, max_input_tokens: int, max_output_tokens: int
) -> ModelWindow:
    return ModelWindow(
        provider="openai",
        api_model=api_model,
        context_tokens=context_tokens,
        max_output_tokens=max_output_tokens,
        max_input_tokens=max_input_tokens,
    )


def _anthropic_window(
    api_model: str, *, context_tokens: int, max_output_tokens: int
) -> ModelWindow:
    return ModelWindow(
        provider="anthropic",
        api_model=api_model,
        context_tokens=context_tokens,
        max_output_tokens=max_output_tokens,
        max_input_tokens=context_tokens - ANTHROPIC_MAX_OUTPUT_TOKENS,
    )


# One entry per API model, from the providers' model pages (checked 2026-11-19):
#   https://developers.openai.com/api/docs/models/<model>
#   https://docs.claude.com/en/docs/about-claude/models/overview
# The frontend's models.ts mirrors max_input_tokens; a test keeps them equal.
MODEL_WINDOWS: dict[str, ModelWindow] = {
    "gpt-6-luna": _openai_window(
        "gpt-6-luna", context_tokens=1_050_000, max_input_tokens=922_000, max_output_tokens=128_000
    ),
    "gpt-6.2-sol": _openai_window(
        "gpt-6.2-sol", context_tokens=1_050_000, max_input_tokens=922_000, max_output_tokens=128_000
    ),
    "gpt-6.2-astra": _openai_window(
        "gpt-6.2-astra",
        context_tokens=1_050_000,
        max_input_tokens=922_000,
        max_output_tokens=128_000,
    ),
    "claude-haiku-5-5": _anthropic_window(
        "claude-haiku-5-5", context_tokens=1_000_000, max_output_tokens=128_000
    ),
    "claude-sonnet-5-5": _anthropic_window(
        "claude-sonnet-5-5", context_tokens=1_000_000, max_output_tokens=128_000
    ),
    "claude-fable-5-2": _anthropic_window(
        "claude-fable-5-2", context_tokens=1_000_000, max_output_tokens=128_000
    ),
}


def get_model_window(api_model: str) -> ModelWindow:
    """The published limits of an API model; a name without an entry is a bug."""
    try:
        return MODEL_WINDOWS[api_model]
    except KeyError:
        known = ", ".join(MODEL_WINDOWS)
        raise ValueError(f"No context window recorded for '{api_model}'. Known: {known}") from None


@dataclass
class ModelConfig:
    """
    A model preset the user can pick: an API model at one reasoning effort.

    Attributes:
        id (SupportedModel): Unique preset identifier used in the UI and config lookups.
        api_model (str): The API model the preset runs on; its limits are in MODEL_WINDOWS.
        label (str): Human-readable display name for the model.
        description (str): Detailed description of the model's capabilities and use cases.
        order (int): Sort order for displaying models in user interfaces.
        reasoning_effort: Level of computational effort the model applies to reasoning tasks.
            Always sent: every supported model reasons by default, at a level that differs
            by model, so leaving it out would hand the choice to the provider.
        refusal_fallback: Whether to let Anthropic re-run a refused request on a stand-in
            model. Set for the models Anthropic offers a server-side fallback for; the
            substitution is announced in the answer (see core/llm.py). Claude Haiku 5.5
            can decline too but has no fallback, so its refusals reach the reader as a
            notice instead.
        plain_prose: Whether to tell the model to prefer a literal phrase over metaphor
            and flourish. Set for models whose answers otherwise read as mannered; the
            instruction itself lives in core/llm.py.
    """

    id: SupportedModel
    api_model: str
    label: str
    description: str
    order: int
    reasoning_effort: ReasoningEffort
    refusal_fallback: bool = False
    plain_prose: bool = False

    @property
    def window(self) -> ModelWindow:
        return get_model_window(self.api_model)

    @property
    def provider(self) -> Provider:
        return self.window.provider

    @property
    def max_input_tokens(self) -> int:
        return self.window.max_input_tokens


MODEL_CONFIGS: dict[SupportedModel, ModelConfig] = {
    "gpt-6-luna": ModelConfig(
        id="gpt-6-luna",
        api_model="gpt-6-luna",
        label="GPT-6 Luna",
        description="Fastest, most economical",
        order=1,
        reasoning_effort="none",
    ),
    "gpt-6.2-sol": ModelConfig(
        id="gpt-6.2-sol",
        api_model="gpt-6.2-sol",
        label="GPT-6.2 Sol",
        description="Balanced performance",
        order=2,
        reasoning_effort="medium",
    ),
    "gpt-6.2-astra-medium": ModelConfig(
        id="gpt-6.2-astra-medium",
        api_model="gpt-6.2-astra",
        label="GPT-6.2 Astra medium",
        description="Most capable",
        order=3,
        reasoning_effort="medium",
    ),
    "gpt-6.2-astra-high": ModelConfig(
        id="gpt-6.2-astra-high",
        api_model="gpt-6.2-astra",
        label="GPT-6.2 Astra high",
        description="High-quality reasoning",
        order=4,
        reasoning_effort="high",
    ),
    "gpt-6.2-astra-max": ModelConfig(
        id="gpt-6.2-astra-max",
        api_model="gpt-6.2-astra",
        label="GPT-6.2 Astra max",
        description="Deepest reasoning (max)",
        order=5,
        reasoning_effort="max",
    ),
    "claude-haiku-5-5": ModelConfig(
        id="claude-haiku-5-5",
        api_model="claude-haiku-5-5",
        label="Claude Haiku 5.5",
        description="Fastest Claude",
        order=6,
        # Haiku 5.5 thinks by default (at medium); low keeps it the fast option.
        reasoning_effort="low",
    ),
    "claude-sonnet-5-5": ModelConfig(
        id="claude-sonnet-5-5",
        api_model="claude-sonnet-5-5",
        label="Claude Sonnet 5.5",
        description="Balanced Claude",
        order=7,
        reasoning_effort="medium",
        refusal_fallback=True,
    ),
    "claude-fable-5-2-medium": ModelConfig(
        id="claude-fable-5-2-medium",
        api_model="claude-fable-5-2",
        label="Claude Fable 5.2 medium",
        description="Most capable Claude",
        order=8,
        reasoning_effort="medium",
        refusal_fallback=True,
        plain_prose=True,
    ),
    "claude-fable-5-2-high": ModelConfig(
        id="claude-fable-5-2-high",
        api_model="claude-fable-5-2",
        label="Claude Fable 5.2 high",
        description="High-quality reasoning",
        order=9,
        reasoning_effort="high",
        refusal_fallback=True,
        plain_prose=True,
    ),
    "claude-fable-5-2-max": ModelConfig(
        id="claude-fable-5-2-max",
        api_model="claude-fable-5-2",
        label="Claude Fable 5.2 max",
        description="Deepest reasoning (max)",
        order=10,
        reasoning_effort="max",
        refusal_fallback=True,
        plain_prose=True,
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
    # Retired 2026-08-18 for the GPT-5.6 family
    "gpt-5.4-nano-2026-03-17": "gpt-6-luna",
    "gpt-5.4-mini-2026-03-17": "gpt-6.2-sol",
    "gpt-5.5-medium": "gpt-6.2-astra-medium",
    "gpt-5.5-high": "gpt-6.2-astra-high",
    "gpt-5.5-xhigh": "gpt-6.2-astra-max",
    # Retired 2026-08-18 for Claude 5
    "claude-sonnet-4-6": "claude-sonnet-5-5",
    "claude-opus-4-8-medium": "claude-fable-5-2-medium",
    "claude-opus-4-8-high": "claude-fable-5-2-high",
    "claude-opus-4-8-xhigh": "claude-fable-5-2-max",
    # Retired 2026-09-09 for GPT-6 Astra
    "gpt-5.6-sol-medium": "gpt-6.2-astra-medium",
    "gpt-5.6-sol-high": "gpt-6.2-astra-high",
    "gpt-5.6-sol-max": "gpt-6.2-astra-max",
    # Retired 2026-09-09 for Claude Fable 5.1
    "claude-opus-5-medium": "claude-fable-5-2-medium",
    "claude-opus-5-high": "claude-fable-5-2-high",
    "claude-opus-5-max": "claude-fable-5-2-max",
    # Retired 2026-11-19 for GPT-6 Luna, GPT-6.2 Sol and GPT-6.2 Astra
    "gpt-5.6-luna": "gpt-6-luna",
    "gpt-5.6-terra": "gpt-6.2-sol",
    "gpt-6-astra-medium": "gpt-6.2-astra-medium",
    "gpt-6-astra-high": "gpt-6.2-astra-high",
    "gpt-6-astra-max": "gpt-6.2-astra-max",
    # Retired 2026-11-19 for Claude Haiku 5.5, Sonnet 5.5 and Fable 5.2
    "claude-haiku-4-5": "claude-haiku-5-5",
    "claude-sonnet-5": "claude-sonnet-5-5",
    "claude-fable-5-1-medium": "claude-fable-5-2-medium",
    "claude-fable-5-1-high": "claude-fable-5-2-high",
    "claude-fable-5-1-max": "claude-fable-5-2-max",
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
