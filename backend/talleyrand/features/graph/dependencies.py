"""
Dependencies for graph feature endpoints.
"""

from typing import Annotated

from fastapi import Header, HTTPException


def get_openai_api_key(
    x_openai_api_key: Annotated[str | None, Header()] = None,
) -> str:
    """Extract OpenAI API key from request header."""
    if not x_openai_api_key:
        raise HTTPException(
            status_code=400,
            detail="OpenAI API key is required. Please provide it via X-OpenAI-API-Key header.",
        )
    return x_openai_api_key
