"""
Token counting utility for managing context limits.
"""

from functools import lru_cache

import tiktoken

from talleyrand.core.model_settings import SupportedModel


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
