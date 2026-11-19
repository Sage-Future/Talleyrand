"""
Token counting for the context meter and for fitting prompts to a window.
"""

from functools import lru_cache

import tiktoken


@lru_cache(maxsize=1)
def _encoding() -> tiktoken.Encoding:
    # Neither CLI exposes a tokenizer, so every prompt is counted with
    # o200k_base, the newest encoding tiktoken has. The count decides how much
    # of an oversized prompt to trim and what the context meter shows, and the
    # agent windows leave room for its error, so an approximation is enough.
    return tiktoken.get_encoding("o200k_base")


def count_tokens(text: str) -> int:
    """Approximate number of tokens in text."""
    return len(_encoding().encode(text))
