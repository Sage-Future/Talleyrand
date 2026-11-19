"""
PDF text for the agent CLIs, which take text only.

The API providers read a PDF themselves; an agent run gets the PDF's text
layer instead, extracted here with pypdf. Bounded so one upload cannot stall
the server or swamp a prompt: at most MAX_PAGES pages are read and
MAX_CHARS characters kept. A PDF with no text layer (a scan), a password, or
a broken structure raises UnreadablePdfError, which callers report to the
reader instead of sending nothing in silence.
"""

import base64
import io
import logging

from pypdf import PdfReader

logger = logging.getLogger(__name__)

MAX_PAGES = 300
MAX_CHARS = 200_000  # roughly 50K tokens, a third of an agent's input budget
TRUNCATED_NOTICE = "\n[... the rest of this PDF was cut to fit ...]"


class UnreadablePdfError(Exception):
    """str(exc) says why, in words for the reader."""


def pdf_text(data_uri: str) -> str:
    """The text layer of a PDF given as data:application/pdf;base64,<payload>."""
    try:
        reader = PdfReader(io.BytesIO(base64.b64decode(data_uri.split(",", 1)[-1])))
        locked = reader.is_encrypted and not reader.decrypt("")
        pages = [] if locked else reader.pages[:MAX_PAGES]
        text = "\n\n".join(page.extract_text() or "" for page in pages).strip()
    except Exception as e:
        # The upload is untrusted, and pypdf reports a damaged file with a
        # spread of exception types.
        logger.info(f"PDF extraction failed: {e!r}")
        raise UnreadablePdfError("it is damaged or not a PDF") from e
    if locked:
        raise UnreadablePdfError("it is password-protected")
    if not text:
        raise UnreadablePdfError("it has no text layer (a scan or images only)")
    if len(text) > MAX_CHARS:
        return text[:MAX_CHARS] + TRUNCATED_NOTICE
    return text
