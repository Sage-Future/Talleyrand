"""
Dependencies for graph feature endpoints.
"""

from typing import Annotated

from fastapi import Header, HTTPException

# The browser client renders a 400's detail verbatim as the error text, so this
# must read as prose and point at the fix (the Settings modal) — never at the
# HTTP header the client sets on its own.
MISSING_OPENAI_KEY_DETAIL = "No OpenAI API key configured. Please add one in Settings to continue."


def get_openai_api_key(
    x_openai_api_key: Annotated[str | None, Header()] = None,
) -> str:
    """Extract OpenAI API key from request header."""
    if not x_openai_api_key:
        raise HTTPException(status_code=400, detail=MISSING_OPENAI_KEY_DETAIL)
    return x_openai_api_key
