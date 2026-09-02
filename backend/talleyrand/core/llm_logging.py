"""
LLM response logging utilities.

Enable by setting LOG_LLM_REQUESTS=true in environment or .env file.

Prompts are not logged. A research prompt is the whole case, documents
included, and even deciding whether to log it meant assembling a copy first;
the response is what is worth reading back.
"""

import logging

from pydantic import BaseModel

from talleyrand.core.config import settings

logger = logging.getLogger("talleyrand.llm")

SEPARATOR = "=" * 80


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
