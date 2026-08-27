"""
Module contains all business logic for issuing the JWT auth token.
"""

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from talleyrand.core.config import settings
from talleyrand.models.user import User

AUTH_CODE_EXPIRE_SECONDS = 60
# Long enough to carry one WebSocket handshake, short enough that a ticket
# copied out of a log is already dead by the time anyone reads it.
STREAM_TICKET_EXPIRE_SECONDS = 30


class InvalidTokenError(Exception):
    """Raised when token validation fails."""


@dataclass
class PendingAuthCode:
    access_token: str
    refresh_token: str
    expires_at: datetime


_pending_auth_codes: dict[str, PendingAuthCode] = {}


def _cleanup_expired_codes() -> None:
    now = datetime.now(UTC)
    expired = [k for k, v in _pending_auth_codes.items() if v.expires_at < now]
    for k in expired:
        del _pending_auth_codes[k]


def create_auth_code(user: User) -> str:
    """Create a short-lived one-time authorization code that can be exchanged for tokens."""
    _cleanup_expired_codes()
    code = secrets.token_urlsafe(32)
    _pending_auth_codes[code] = PendingAuthCode(
        access_token=create_access_token(user),
        refresh_token=create_refresh_token(user),
        expires_at=datetime.now(UTC) + timedelta(seconds=AUTH_CODE_EXPIRE_SECONDS),
    )
    return code


def exchange_auth_code(code: str) -> tuple[str, str]:
    """Exchange a one-time auth code for (access_token, refresh_token). Consumes the code."""
    _cleanup_expired_codes()
    pending = _pending_auth_codes.pop(code, None)
    if not pending:
        raise InvalidTokenError("Invalid or expired authorization code")
    if pending.expires_at < datetime.now(UTC):
        raise InvalidTokenError("Authorization code expired")
    return pending.access_token, pending.refresh_token


def _encode(user: User, token_type: str, lifetime: timedelta, **extra: Any) -> str:
    """Sign a JWT carrying the user's identity, its purpose and its lifetime."""
    claims: dict[str, Any] = {
        "sub": user.id,
        "email": user.email,
        "name": user.name,
        "picture": user.picture,
        "exp": datetime.now(UTC) + lifetime,
        "type": token_type,
        **extra,
    }
    return jwt.encode(claims, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(user: User) -> str:
    """Create JWT access token for a user."""
    return _encode(user, "access", timedelta(minutes=settings.jwt_access_token_expire_minutes))


def create_refresh_token(user: User) -> str:
    """Create JWT refresh token for a user."""
    return _encode(user, "refresh", timedelta(days=settings.jwt_refresh_token_expire_days))


def create_stream_ticket(user: User, graph_id: str) -> str:
    """
    Mint a one-case, short-lived credential for opening that case's event stream.

    A browser cannot set headers on a WebSocket handshake, so whatever
    authenticates the stream travels in the URL — and URLs are written to
    server logs. This ticket is what ends up there instead of the access
    token: it opens one case's stream for half a minute and is worthless
    against the HTTP API, so a leaked log line is no longer a leaked account.
    """
    return _encode(
        user,
        "stream",
        timedelta(seconds=STREAM_TICKET_EXPIRE_SECONDS),
        graph=graph_id,
    )


def _decode(token: str | None, token_type: str) -> dict[str, Any]:
    """Decode a JWT and check it is the kind of token the caller asked for."""
    if not token:
        raise InvalidTokenError("Could not validate credentials")

    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as e:
        raise InvalidTokenError("Could not validate credentials") from e

    if payload.get("type") != token_type:
        raise InvalidTokenError("Could not validate credentials")

    if payload.get("sub") is None:
        raise InvalidTokenError("Could not validate credentials")

    return payload


def _user_of(payload: dict[str, Any]) -> User:
    return User(
        id=payload["sub"],
        email=payload["email"],
        name=payload["name"],
        picture=payload["picture"],
    )


def verify_token(token: str | None, token_type: str = "access") -> User:
    """Verify a JWT and return the user it identifies."""
    return _user_of(_decode(token, token_type))


def verify_stream_ticket(ticket: str | None, graph_id: str) -> User:
    """Verify a stream ticket and that it was issued for this very case."""
    payload = _decode(ticket, "stream")
    if payload.get("graph") != graph_id:
        raise InvalidTokenError("Ticket was issued for a different case")
    return _user_of(payload)
