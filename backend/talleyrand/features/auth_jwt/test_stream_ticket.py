"""
The live-answer stream authenticates with a ticket rather than the session
token, because a WebSocket URL — query string and all — ends up in server
logs. These tests pin what makes that safe: a ticket opens one case, expires
in seconds, and no other credential opens a stream at all.
"""

from datetime import timedelta

import pytest

from talleyrand.features.auth_jwt import service
from talleyrand.models.user import User

CASE = "4420ccbf-f973-4ae4-9f68-8c1d7d7c50c8"
OTHER_CASE = "11111111-1111-1111-1111-111111111111"

user = User(id="uid", email="user@example.com", name="User", picture="")


def test_ticket_opens_the_case_it_was_issued_for():
    ticket = service.create_stream_ticket(user, CASE)

    assert service.verify_stream_ticket(ticket, CASE).email == user.email


def test_ticket_does_not_open_another_case():
    ticket = service.create_stream_ticket(user, CASE)

    with pytest.raises(service.InvalidTokenError):
        service.verify_stream_ticket(ticket, OTHER_CASE)


def test_ticket_is_not_an_api_credential():
    ticket = service.create_stream_ticket(user, CASE)

    with pytest.raises(service.InvalidTokenError):
        service.verify_token(ticket, token_type="access")


def test_session_tokens_do_not_open_a_stream():
    for token in (service.create_access_token(user), service.create_refresh_token(user)):
        with pytest.raises(service.InvalidTokenError):
            service.verify_stream_ticket(token, CASE)


def test_expired_ticket_is_refused():
    expired = service._encode(user, "stream", timedelta(seconds=-1), graph=CASE)

    with pytest.raises(service.InvalidTokenError):
        service.verify_stream_ticket(expired, CASE)


def test_missing_ticket_is_refused():
    with pytest.raises(service.InvalidTokenError):
        service.verify_stream_ticket(None, CASE)
