"""
Keep credentials out of the server log.

A browser cannot put an Authorization header on a WebSocket handshake, so the
stream URL carries its own credential in the query string — and uvicorn writes
request paths, query string included, to the log on every connection. That
line comes from the error logger rather than the access logger, so turning
access logs off does not silence it, and anyone who is handed a log file (a
self-hoster pasting output into a bug report, say) is handed its contents too.

Stream tickets are already short-lived and scoped to one case, so a leaked
line is no longer a leaked account. This is the second half of the same fix:
nothing from a query string reaches the log in the first place.
"""

import logging

REDACTED = "?<redacted>"

# The loggers that render request paths: the access log for HTTP requests, the
# error log for the WebSocket connect/disconnect lines.
_REQUEST_LOGGERS = ("uvicorn.access", "uvicorn.error")


class QueryStringRedactionFilter(logging.Filter):
    """Replace the query string of any request path passed as a log argument."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(self._redact(arg) for arg in record.args)
        return True

    @staticmethod
    def _redact(arg: object) -> object:
        if isinstance(arg, str) and arg.startswith("/") and "?" in arg:
            return arg.partition("?")[0] + REDACTED
        return arg


def install_query_string_redaction() -> None:
    """Redact query strings from uvicorn's request logging, for this process."""
    for name in _REQUEST_LOGGERS:
        logger = logging.getLogger(name)
        if not any(isinstance(f, QueryStringRedactionFilter) for f in logger.filters):
            logger.addFilter(QueryStringRedactionFilter())
