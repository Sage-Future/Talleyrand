"""
LLM request/response logging utilities.

Enable by setting LOG_LLM_REQUESTS=true in environment or .env file.
"""

import logging

from pydantic import BaseModel

from talleyrand.core.config import settings

logger = logging.getLogger("talleyrand.llm")

SEPARATOR = "=" * 80


def log_prompt(
    caller: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
) -> None:
    """Log the full LLM prompt (system + user) if logging is enabled."""
    if not settings.log_llm_requests:
        return

    logger.info(
        "\n%s\nLLM REQUEST [%s] model=%s\n%s\nSYSTEM PROMPT:\n%s\n%s\nUSER PROMPT:\n%s\n%s",
        SEPARATOR,
        caller,
        model,
        SEPARATOR,
        system_prompt,
        "-" * 80,
        user_prompt,
        SEPARATOR,
    )


def log_response(caller: str, response_text: str) -> None:
    """Log a plain text LLM response if logging is enabled."""
    if not settings.log_llm_requests:
        return

    logger.info(
        "\n%s\nLLM RESPONSE [%s]\n%s\n%s\n%s",
        SEPARATOR,
        caller,
        SEPARATOR,
        response_text,
        SEPARATOR,
    )


def log_structured_response(caller: str, parsed: BaseModel) -> None:
    """Log a structured (Pydantic) LLM response if logging is enabled."""
    if not settings.log_llm_requests:
        return

    logger.info(
        "\n%s\nLLM STRUCTURED RESPONSE [%s]\n%s\n%s\n%s",
        SEPARATOR,
        caller,
        SEPARATOR,
        parsed.model_dump_json(indent=2),
        SEPARATOR,
    )
