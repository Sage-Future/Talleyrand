"""
Token counting utility for managing context limits.
"""

import logging
from functools import lru_cache

import tiktoken

from talleyrand.core.model_settings import SupportedModel, get_model_config

logger = logging.getLogger(__name__)


@lru_cache(maxsize=8)
def get_encoding_for_model(model: SupportedModel) -> tiktoken.Encoding:
    """
    Get the tiktoken encoding for a given model.

    For GPT-5 series models (which are using GPT-4's architecture),
    we use the o200k_base encoding.

    Args:
        model: The model identifier

    Returns:
        tiktoken.Encoding instance for the model
    """
    # All current GPT-5 models use o200k_base encoding
    # This is the same encoding used by GPT-4 and later models
    return tiktoken.get_encoding("o200k_base")


def count_tokens(text: str, model: SupportedModel) -> int:
    """
    Count the number of tokens in a text string for a given model.

    Args:
        text: The text to count tokens for
        model: The model identifier to use for encoding

    Returns:
        Number of tokens in the text
    """
    encoding = get_encoding_for_model(model)
    return len(encoding.encode(text))


def truncate_to_token_limit(
    system_prompt: str, user_prompt: str, model: SupportedModel, reserve_tokens: int = 100
) -> str:
    """
    Truncate user prompt to fit within model's token limit.

    Removes text from the beginning of the prompt until it fits,
    preserving the most recent context (which is at the end).

    Args:
        system_prompt: The system prompt (counted but not truncated)
        user_prompt: The user prompt to potentially truncate
        model: The model being used
        reserve_tokens: Tokens to reserve for response generation

    Returns:
        Truncated user prompt that fits within token limits
    """
    max_tokens = get_model_config(model).context_tokens
    target_tokens = max_tokens - reserve_tokens

    # Count system prompt tokens
    system_tokens = count_tokens(system_prompt, model)
    available_tokens = target_tokens - system_tokens

    # If user prompt fits, return as-is
    user_tokens = count_tokens(user_prompt, model)
    if user_tokens <= available_tokens:
        return user_prompt

    logger.warning(
        f"User prompt exceeds token limit: {user_tokens} > {available_tokens}. "
        "Truncating from start..."
    )

    # Calculate how many tokens we need to remove
    excessive_tokens = user_tokens - available_tokens

    # Rough estimate: ~7 characters per token for initial cut
    chars_to_remove = excessive_tokens * 7

    truncated = user_prompt
    if chars_to_remove > 0 and chars_to_remove < len(truncated):
        truncated = truncated[chars_to_remove:]

    # Fine-tune by cutting 300 characters at a time until it fits
    while count_tokens(truncated, model) > available_tokens and len(truncated) > 300:
        truncated = truncated[300:]

    final_tokens = count_tokens(truncated, model)
    removed_tokens = user_tokens - final_tokens
    logger.info(
        f"Truncated {removed_tokens} tokens from user prompt ({user_tokens} -> {final_tokens})"
    )

    return truncated
