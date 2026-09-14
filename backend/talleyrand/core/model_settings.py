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


# One entry per API model, from the providers' model pages (checked 2026-09-14):
#   https://developers.openai.com/api/docs/models/<model>
#   https://docs.claude.com/en/docs/about-claude/models/overview
# The frontend's models.ts mirrors max_input_tokens; a test keeps them equal.
MODEL_WINDOWS: dict[str, ModelWindow] = {
    "gpt-5.6-luna": _openai_window(
        "gpt-5.6-luna",
        context_tokens=1_050_000,
        max_input_tokens=922_000,
        max_output_tokens=128_000,
    ),
    "gpt-5.6-terra": _openai_window(
        "gpt-5.6-terra",
        context_tokens=1_050_000,
        max_input_tokens=922_000,
        max_output_tokens=128_000,
    ),
    "gpt-6-astra": _openai_window(
        "gpt-6-astra", context_tokens=1_050_000, max_input_tokens=922_000, max_output_tokens=128_000
    ),
    "claude-haiku-4-5": _anthropic_window(
        "claude-haiku-4-5", context_tokens=200_000, max_output_tokens=64_000
    ),
    "claude-sonnet-5": _anthropic_window(
        "claude-sonnet-5", context_tokens=1_000_000, max_output_tokens=128_000
    ),
    "claude-fable-5-1": _anthropic_window(
        "claude-fable-5-1", context_tokens=1_000_000, max_output_tokens=128_000
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
        refusal_fallback: Whether to let Anthropic re-run a refused request on a stand-in
            model. Only set for models whose safety classifiers can decline a request
            outright; the substitution is announced in the answer (see core/llm.py).
        plain_prose: Whether to tell the model to prefer a literal phrase over metaphor
            and flourish. Set for models whose answers otherwise read as mannered; the
            instruction itself lives in core/llm.py.
    """

    id: SupportedModel
    api_model: str
    label: str
    description: str
    order: int
    reasoning_effort: ReasoningEffort | None
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
    "gpt-5.6-luna": ModelConfig(
        id="gpt-5.6-luna",
        api_model="gpt-5.6-luna",
        label="GPT-5.6 Luna",
        description="Fastest, most economical",
        order=1,
        reasoning_effort="none",
    ),
    "gpt-5.6-terra": ModelConfig(
        id="gpt-5.6-terra",
        api_model="gpt-5.6-terra",
        label="GPT-5.6 Terra",
        description="Balanced performance",
        order=2,
        reasoning_effort="medium",
    ),
    "gpt-6-astra-medium": ModelConfig(
        id="gpt-6-astra-medium",
        api_model="gpt-6-astra",
        label="GPT-6 Astra medium",
        description="Most capable",
        order=3,
        reasoning_effort="medium",
    ),
    "gpt-6-astra-high": ModelConfig(
        id="gpt-6-astra-high",
        api_model="gpt-6-astra",
        label="GPT-6 Astra high",
        description="High-quality reasoning",
        order=4,
        reasoning_effort="high",
    ),
    "gpt-6-astra-max": ModelConfig(
        id="gpt-6-astra-max",
        api_model="gpt-6-astra",
        label="GPT-6 Astra max",
        description="Deepest reasoning (max)",
        order=5,
        reasoning_effort="max",
    ),
    "claude-haiku-4-5": ModelConfig(
        id="claude-haiku-4-5",
        api_model="claude-haiku-4-5",
        label="Claude Haiku 4.5",
        description="Fastest Claude",
        order=6,
        reasoning_effort=None,
    ),
    "claude-sonnet-5": ModelConfig(
        id="claude-sonnet-5",
        api_model="claude-sonnet-5",
        label="Claude Sonnet 5",
        description="Balanced Claude",
        order=7,
        reasoning_effort="medium",
    ),
    "claude-fable-5-1-medium": ModelConfig(
        id="claude-fable-5-1-medium",
        api_model="claude-fable-5-1",
        label="Claude Fable 5.1 medium",
        description="Most capable Claude",
        order=8,
        reasoning_effort="medium",
        refusal_fallback=True,
        plain_prose=True,
    ),
    "claude-fable-5-1-high": ModelConfig(
        id="claude-fable-5-1-high",
        api_model="claude-fable-5-1",
        label="Claude Fable 5.1 high",
        description="High-quality reasoning",
        order=9,
        reasoning_effort="high",
        refusal_fallback=True,
        plain_prose=True,
    ),
    "claude-fable-5-1-max": ModelConfig(
        id="claude-fable-5-1-max",
        api_model="claude-fable-5-1",
        label="Claude Fable 5.1 max",
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
