"""
Tests for making a case fit its model's context window.

What must survive is fixed: the brief and the question tree are what the answer
is about, so the attached documents are the section that gives way. And what
survives must be identical across a case's questions, or the cached prefix each
one sends stops matching and the case pays full price for every question.
"""

import pytest

from talleyrand.core import llm as llm_module
from talleyrand.core.llm import TRIM_STEP_CHARS, TRIMMED_NOTICE, fit_to_context
from talleyrand.core.model_settings import get_model_config

MODEL = get_model_config("claude-fable-5-1-max")
# The stub below counts four characters to the token, so a window in tokens is
# four times as many characters of prompt.
CHARS_PER_TOKEN = 4

BRIEF = "BRIEF:\nWhether the deal holds.\n\n"
DOCUMENTS = "CASE DOCUMENTS:\n  - plan: " + ("plan text. " * 40_000) + "\n\n"
BODY = "CASE TREE (fixed order; the user's case so far):\n[1] QUESTION: Does it hold?\n"


@pytest.fixture
def counted(monkeypatch):
    """Count tokens without a provider: four characters to the token."""

    async def count(_client, _model, system_prompt, user_prompt) -> int:
        return len(system_prompt + user_prompt) // CHARS_PER_TOKEN

    monkeypatch.setattr(llm_module, "_count_anthropic_tokens", count)


async def fit(documents: str, body: str = BODY, brief: str = BRIEF) -> str:
    return await fit_to_context(
        model=MODEL,
        api_key="unused",
        system_prompt="INSTRUCTIONS",
        keep_before=brief,
        trimmable=documents,
        keep_after=body,
    )


@pytest.mark.asyncio
async def test_prompt_within_the_window_is_left_alone(counted):
    assert await fit("CASE DOCUMENTS:\n  - plan: short\n\n") == (
        "CASE DOCUMENTS:\n  - plan: short\n\n"
    )


@pytest.mark.asyncio
async def test_oversized_case_loses_documents_and_keeps_the_rest(counted):
    documents = "CASE DOCUMENTS:\n  - plan: " + ("plan text. " * 500_000) + "\n\n"

    fitted = await fit(documents)

    assert len(fitted) < len(documents)
    assert fitted.startswith("CASE DOCUMENTS:\n  - plan: plan text.")
    assert fitted.endswith(TRIMMED_NOTICE)
    # The brief and the tree are untouched: fit_to_context only ever returns the
    # trimmable section, and the whole prompt now fits with them intact.
    fitted_tokens = len("INSTRUCTIONS" + BRIEF + fitted + BODY) // CHARS_PER_TOKEN
    assert fitted_tokens <= MODEL.context_tokens


@pytest.mark.asyncio
async def test_two_questions_in_a_case_trim_documents_identically(counted):
    """
    The cache breakpoint sits after the documents, so two questions asked
    against the same case must produce byte-identical documents — otherwise the
    second one writes its own cache entry instead of reading the first's.
    """
    documents = "CASE DOCUMENTS:\n  - plan: " + ("plan text. " * 500_000) + "\n\n"
    tree = "CASE TREE (fixed order; the user's case so far):\n"

    first = await fit(documents, body=tree + "CURRENT QUESTION: [1] Does it hold?\n")
    second = await fit(
        documents,
        body=tree + "CURRENT QUESTION: [2] What would it take for the deal to fail outright?\n",
    )

    assert first == second


@pytest.mark.asyncio
async def test_trim_lands_on_a_step_boundary(counted):
    documents = "CASE DOCUMENTS:\n  - plan: " + ("plan text. " * 500_000) + "\n\n"

    fitted = await fit(documents)

    assert (len(fitted) - len(TRIMMED_NOTICE)) % TRIM_STEP_CHARS == 0
