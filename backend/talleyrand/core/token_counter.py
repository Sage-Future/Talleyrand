"""
Token counting for OpenAI models.
"""

from functools import lru_cache

import tiktoken


@lru_cache(maxsize=8)
def get_encoding_for_model(api_model: str) -> tiktoken.Encoding:
    """
    The tiktoken encoding to count an OpenAI model's prompt with.

    tiktoken ships no entry for the GPT-5.6 or GPT-6 families, so every
    OpenAI model is counted with o200k_base, the newest encoding it has. The
    count decides how much of an oversized prompt to trim and what the context
    meter shows, so a close approximation is enough.

    Args:
        api_model: The model name sent to the API

    Returns:
        tiktoken.Encoding instance for the model
    """
    # o200k_base is the encoding tiktoken knows for GPT-4o and GPT-5; the
    # GPT-5.6 and GPT-6 Astra models have no entry of their own.
    return tiktoken.get_encoding("o200k_base")


def count_tokens(text: str, api_model: str) -> int:
    """
    Count the number of tokens in a text string for a given OpenAI model.

    Args:
        text: The text to count tokens for
        api_model: The model name sent to the API

    Returns:
        Number of tokens in the text
    """
    encoding = get_encoding_for_model(api_model)
    return len(encoding.encode(text))
