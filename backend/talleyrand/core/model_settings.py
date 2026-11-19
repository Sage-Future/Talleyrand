from dataclasses import dataclass
from typing import Literal, cast

from talleyrand.core.config import settings

type SupportedModel = Literal[
    "claude-code-haiku-4-5",
    "claude-code-sonnet-5-5",
    "claude-code-opus-5-5",
    "claude-code-fable-5-1",
    "hermes-gpt-6-luna",
    "hermes-gpt-6-sol",
    "hermes-gpt-6-1-sol",
    "hermes-gpt-6-astra",
]

type Provider = Literal["claude_code", "hermes"]


@dataclass(frozen=True)
class ModelWindow:
    """
    How much one agent CLI reads and writes.

    Attributes:
        provider: The agent CLI.
        api_model: The window's name, which ModelConfig.api_model refers to.
        context_tokens: The window that input and output share.
        max_output_tokens: The most the model may write in one response.
        max_input_tokens: The most a request may carry.
    """

    provider: Provider
    api_model: str
    context_tokens: int
    max_output_tokens: int
    max_input_tokens: int


# Which model each CLI runs is the preset's (ModelConfig.agent_model), so these
# are conservative budgets rather than a published window: a subscription plan
# need not grant a model's full API window. 200K is the standard Claude window;
# the input budget leaves room for the answer and for counting with tiktoken,
# which runs low on Claude's tokenizer. The frontend's models.ts mirrors
# max_input_tokens; a test keeps them equal.
MODEL_WINDOWS: dict[str, ModelWindow] = {
    # The operator's `claude` CLI (core/claude_code.py).
    "claude-code": ModelWindow(
        provider="claude_code",
        api_model="claude-code",
        context_tokens=200_000,
        max_output_tokens=32_000,
        max_input_tokens=150_000,
    ),
    # The operator's `hermes` CLI (core/hermes.py).
    "hermes": ModelWindow(
        provider="hermes",
        api_model="hermes",
        context_tokens=200_000,
        max_output_tokens=32_000,
        max_input_tokens=150_000,
    ),
}

# The window each agent backend runs under.
AGENT_PRESETS: dict[str, str] = {"claude_code": "claude-code", "hermes": "hermes"}


def get_model_window(api_model: str) -> ModelWindow:
    """The limits of an agent CLI's window; a name without an entry is a bug."""
    try:
        return MODEL_WINDOWS[api_model]
    except KeyError:
        known = ", ".join(MODEL_WINDOWS)
        raise ValueError(f"No context window recorded for '{api_model}'. Known: {known}") from None


def auxiliary_window() -> ModelWindow:
    """
    The window the agent's own work (kickstart, suggestions, reports) fits its
    prompt to: that of settings.agent_backend, which runs it.
    """
    return MODEL_WINDOWS[AGENT_PRESETS[settings.agent_backend]]


@dataclass
class ModelConfig:
    """
    A model preset the user can pick: one model on one agent CLI.

    Attributes:
        id (SupportedModel): Unique preset identifier used in the UI and config lookups.
        api_model (str): The agent CLI's window in MODEL_WINDOWS.
        label (str): Human-readable display name for the model.
        description (str): Detailed description of the model's capabilities and use cases.
        order (int): Sort order for displaying models in user interfaces.
        agent_model (str): The model answers ask the CLI for (`--model`).
    """

    id: SupportedModel
    api_model: str
    label: str
    description: str
    order: int
    agent_model: str

    @property
    def window(self) -> ModelWindow:
        return get_model_window(self.api_model)

    @property
    def provider(self) -> Provider:
        return self.window.provider

    @property
    def max_input_tokens(self) -> int:
        return self.window.max_input_tokens


# One preset per model the signed-in subscriptions offer, fastest first. Model
# names checked 2026-09-30 against the Claude Code changelog and the live
# openai-codex list Hermes fetches (`hermes model`).
MODEL_CONFIGS: dict[SupportedModel, ModelConfig] = {
    "claude-code-haiku-4-5": ModelConfig(
        id="claude-code-haiku-4-5",
        api_model="claude-code",
        label="Claude Haiku 4.5",
        description="Fastest Claude, on your Claude subscription",
        order=1,
        agent_model="claude-haiku-4-5",
    ),
    "claude-code-sonnet-5-5": ModelConfig(
        id="claude-code-sonnet-5-5",
        api_model="claude-code",
        label="Claude Sonnet 5.5",
        description="Balanced Claude, on your Claude subscription",
        order=2,
        agent_model="claude-sonnet-5-5",
    ),
    "claude-code-opus-5-5": ModelConfig(
        id="claude-code-opus-5-5",
        api_model="claude-code",
        label="Claude Opus 5.5",
        description="Strongest Opus, on your Claude subscription",
        order=3,
        agent_model="claude-opus-5-5",
    ),
    "claude-code-fable-5-1": ModelConfig(
        id="claude-code-fable-5-1",
        api_model="claude-code",
        label="Claude Fable 5.1",
        description="Most capable Claude, on your Claude subscription",
        order=4,
        agent_model="claude-fable-5-1",
    ),
    "hermes-gpt-6-luna": ModelConfig(
        id="hermes-gpt-6-luna",
        api_model="hermes",
        label="GPT-6 Luna",
        description="Fastest GPT, on your ChatGPT subscription",
        order=5,
        agent_model="gpt-6-luna",
    ),
    "hermes-gpt-6-sol": ModelConfig(
        id="hermes-gpt-6-sol",
        api_model="hermes",
        label="GPT-6 Sol",
        description="Balanced GPT, on your ChatGPT subscription",
        order=6,
        agent_model="gpt-6-sol",
    ),
    "hermes-gpt-6-1-sol": ModelConfig(
        id="hermes-gpt-6-1-sol",
        api_model="hermes",
        label="GPT-6.1 Sol",
        description="Newest Sol, on your ChatGPT subscription",
        order=7,
        agent_model="gpt-6.1-sol",
    ),
    "hermes-gpt-6-astra": ModelConfig(
        id="hermes-gpt-6-astra",
        api_model="hermes",
        label="GPT-6 Astra",
        description="Most capable GPT, on your ChatGPT subscription",
        order=8,
        agent_model="gpt-6-astra",
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
    # The API-key presets, retired 2026-09-30 with the hosted deployment for
    # the same model (or its successor) on the matching agent CLI: GPT on
    # Hermes, Claude on Claude Code.
    "gpt-5.6-luna": "hermes-gpt-6-luna",
    "gpt-5.6-terra": "hermes-gpt-6-sol",
    "gpt-6-astra-medium": "hermes-gpt-6-astra",
    "gpt-6-astra-high": "hermes-gpt-6-astra",
    "gpt-6-astra-max": "hermes-gpt-6-astra",
    "claude-haiku-4-5": "claude-code-haiku-4-5",
    "claude-sonnet-5": "claude-code-sonnet-5-5",
    "claude-fable-5-1-medium": "claude-code-fable-5-1",
    "claude-fable-5-1-high": "claude-code-fable-5-1",
    "claude-fable-5-1-max": "claude-code-fable-5-1",
    # Retired 2026-08-18 for the GPT-5.6 family
    "gpt-5.4-nano-2026-03-17": "hermes-gpt-6-luna",
    "gpt-5.4-mini-2026-03-17": "hermes-gpt-6-sol",
    "gpt-5.5-medium": "hermes-gpt-6-astra",
    "gpt-5.5-high": "hermes-gpt-6-astra",
    "gpt-5.5-xhigh": "hermes-gpt-6-astra",
    # Retired 2026-08-18 for Claude 5
    "claude-sonnet-4-6": "claude-code-sonnet-5-5",
    "claude-opus-4-8-medium": "claude-code-fable-5-1",
    "claude-opus-4-8-high": "claude-code-fable-5-1",
    "claude-opus-4-8-xhigh": "claude-code-fable-5-1",
    # Retired 2026-09-09, replaced by GPT-6 Astra
    "gpt-5.6-sol-medium": "hermes-gpt-6-astra",
    "gpt-5.6-sol-high": "hermes-gpt-6-astra",
    "gpt-5.6-sol-max": "hermes-gpt-6-astra",
    # Retired 2026-09-09, replaced by Claude Fable 5.1
    "claude-opus-5-medium": "claude-code-fable-5-1",
    "claude-opus-5-high": "claude-code-fable-5-1",
    "claude-opus-5-max": "claude-code-fable-5-1",
    # Retired 2026-09-30: one preset per agent became one per model it can run.
    # Each ran settings.claude_code_model / settings.hermes_model, by default
    # these two.
    "claude-code": "claude-code-sonnet-5-5",
    "hermes": "hermes-gpt-6-astra",
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
