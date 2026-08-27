"""
Query strings must never reach the log: the stream URL carries a credential
there, and uvicorn logs request paths in full — on the error logger, which
survives turning access logs off.
"""

import logging

from talleyrand.infra.log_redaction import (
    QueryStringRedactionFilter,
    install_query_string_redaction,
)


def _record(*args: object) -> logging.LogRecord:
    return logging.LogRecord("uvicorn.error", logging.INFO, "", 0, "%s - %s", args, None)


def test_query_string_is_replaced_and_the_path_kept():
    record = _record("127.0.0.1:1234", "/research/abc/stream?ticket=secret")

    QueryStringRedactionFilter().filter(record)

    assert record.args == ("127.0.0.1:1234", "/research/abc/stream?<redacted>")


def test_paths_without_a_query_string_are_untouched():
    record = _record("127.0.0.1:1234", "/research/abc/stream")

    QueryStringRedactionFilter().filter(record)

    assert record.args == ("127.0.0.1:1234", "/research/abc/stream")


def test_non_path_arguments_are_untouched():
    record = _record("GET", 200, "why? because")

    QueryStringRedactionFilter().filter(record)

    assert record.args == ("GET", 200, "why? because")


def test_installing_twice_leaves_one_filter():
    install_query_string_redaction()
    install_query_string_redaction()

    for name in ("uvicorn.access", "uvicorn.error"):
        filters = logging.getLogger(name).filters
        assert sum(isinstance(f, QueryStringRedactionFilter) for f in filters) == 1
