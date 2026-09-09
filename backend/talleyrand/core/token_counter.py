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

    tiktoken ships no entry for the GPT-5.6 or GPT-6 families, so every
    OpenAI model is counted with o200k_base, the newest encoding it has. The
    count only decides how much of an oversized prompt to trim, so a close
    approximation is enough.

    Args:
        model: The model identifier

    Returns:
        tiktoken.Encoding instance for the model
    """
    # o200k_base is the encoding tiktoken knows for GPT-4o and GPT-5; the
    # GPT-5.6 and GPT-6 Astra models have no entry of their own.
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
