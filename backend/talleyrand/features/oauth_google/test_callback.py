import logging
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from . import service
from .app import router

logging.basicConfig(level=logging.INFO)

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def _get_oauth_state_and_token(next_url: str = "http://localhost:3000/home"):
    """
    Helper to get oauth_state cookie and state token from redirect_url endpoint.

    The client is shared by every test in this module, so the cookie the
    endpoint just set is stripped from its jar before returning. Each test then
    states exactly which cookie it sends, and the ones that send none — the
    login-CSRF cases — really send none. Left in the jar, the cookie replays on
    the next request whenever it is not marked Secure, and those tests pass a
    valid cookie to the very check they exist to exercise.
    """
    response = client.get(
        f"/oauth/google/redirect_url?next_url={next_url}",
        follow_redirects=False,
    )
    assert response.status_code == 307

    oauth_state_cookie = response.cookies.get("oauth_state")
    client.cookies.clear()
    location = response.headers["location"]
    qs_data = parse_qs(urlparse(location).query)
    state_token = qs_data["state"][0]

    return oauth_state_cookie, state_token


@pytest.mark.asyncio
async def test_callback_missing_oauth_state_cookie():
    """Callback without oauth_state cookie should fail."""
    _, state_token = _get_oauth_state_and_token()

    callback = f"/oauth/google/callback?state={state_token}&code=test_code&scope=email+profile"

    # No cookies passed
    data = client.get(callback, follow_redirects=False)

    assert data.status_code == 307
    assert "error_message" in data.headers["location"]
    assert "Missing" in data.headers["location"] or "cookie" in data.headers["location"].lower()


@pytest.mark.asyncio
async def test_callback_state_mismatch():
    """Callback with mismatched state token should fail (login CSRF protection)."""
    oauth_state_cookie, _ = _get_oauth_state_and_token()

    # Use a different state token than what's in the cookie
    wrong_state = "completely_wrong_state_token"
    callback = f"/oauth/google/callback?state={wrong_state}&code=test_code&scope=email+profile"

    data = client.get(callback, cookies={"oauth_state": oauth_state_cookie}, follow_redirects=False)

    assert data.status_code == 307
    assert "error_message" in data.headers["location"]


@pytest.mark.asyncio
async def test_callback_invalid_oauth_state_cookie():
    """Callback with invalid/tampered oauth_state cookie should fail."""
    _, state_token = _get_oauth_state_and_token()

    callback = f"/oauth/google/callback?state={state_token}&code=test_code&scope=email+profile"

    # Pass invalid cookie
    data = client.get(
        callback, cookies={"oauth_state": "invalid_jwt_token"}, follow_redirects=False
    )

    assert data.status_code == 307
    assert "error_message" in data.headers["location"]


@pytest.mark.asyncio
async def test_callback_successful_with_tokens(monkeypatch: MonkeyPatch):
    """Successful callback should set access and refresh tokens."""
    url = "http://localhost:3000/home"
    oauth_state_cookie, state_token = _get_oauth_state_and_token(url)

    monkeypatch.setattr(
        service,
        "exchange_code_for_token",
        AsyncMock(
            return_value=service.GoogleTokenResponse(
                access_token="google_access_token",
                token_type="Bearer",
                expires_in=3600,
                refresh_token="google_refresh_token",
                scope="https://www.googleapis.com/auth/userinfo.email openid profile",
                id_token="id_token",
            )
        ),
    )

    monkeypatch.setattr(
        service,
        "get_user_info",
        AsyncMock(
            return_value=service.GoogleUserInfo(
                id="123456789",
                email="test@example.com",
                name="Test User",
                picture="https://example.com/pic.jpg",
                verified_email=True,
                given_name="Test",
                family_name="User",
                locale="en",
            )
        ),
    )

    callback = (
        f"/oauth/google/callback?state={state_token}&code=test_code&scope=email+profile+openid"
    )

    data = client.get(callback, cookies={"oauth_state": oauth_state_cookie}, follow_redirects=False)

    assert data.status_code == 307
    location = data.headers["location"]
    # Verify auth code is appended to redirect URL
    assert "code=" in location
    assert location.startswith(url)
    # Verify no token cookies are set (tokens are now returned via code exchange)
    assert "access_token" not in data.cookies
    assert "refresh_token" not in data.cookies


@pytest.mark.asyncio
async def test_callback_missing_email_scope(monkeypatch: MonkeyPatch):
    """Callback without email scope should fail."""
    oauth_state_cookie, state_token = _get_oauth_state_and_token()

    monkeypatch.setattr(
        service,
        "exchange_code_for_token",
        AsyncMock(
            return_value=service.GoogleTokenResponse(
                access_token="test_token",
                token_type="Bearer",
                expires_in=3600,
                refresh_token=None,
                scope="openid profile",  # Missing email scope
                id_token=None,
            )
        ),
    )

    callback = f"/oauth/google/callback?state={state_token}&code=test_code&scope=profile+openid"

    data = client.get(callback, cookies={"oauth_state": oauth_state_cookie}, follow_redirects=False)

    assert data.status_code == 307
    assert "error_message" in data.headers["location"]


@pytest.mark.asyncio
async def test_callback_unverified_email(monkeypatch: MonkeyPatch):
    """Callback with unverified email should fail."""
    oauth_state_cookie, state_token = _get_oauth_state_and_token()

    monkeypatch.setattr(
        service,
        "exchange_code_for_token",
        AsyncMock(
            return_value=service.GoogleTokenResponse(
                access_token="test_token",
                token_type="Bearer",
                expires_in=3600,
                refresh_token=None,
                scope="https://www.googleapis.com/auth/userinfo.email openid profile",
                id_token=None,
            )
        ),
    )

    monkeypatch.setattr(
        service,
        "get_user_info",
        AsyncMock(
            return_value=service.GoogleUserInfo(
                id="123456789",
                email="test@example.com",
                name="Test User",
                picture="https://example.com/pic.jpg",
                verified_email=False,  # Email not verified
                given_name="Test",
                family_name="User",
                locale="en",
            )
        ),
    )

    callback = (
        f"/oauth/google/callback?state={state_token}&code=test_code&scope=email+profile+openid"
    )

    data = client.get(callback, cookies={"oauth_state": oauth_state_cookie}, follow_redirects=False)

    assert data.status_code == 307
    assert "error_message" in data.headers["location"]


@pytest.mark.asyncio
async def test_callback_user_info_retrieval_failure(monkeypatch: MonkeyPatch):
    """Callback with failed user info retrieval should fail."""
    oauth_state_cookie, state_token = _get_oauth_state_and_token()

    monkeypatch.setattr(
        service,
        "exchange_code_for_token",
        AsyncMock(
            return_value=service.GoogleTokenResponse(
                access_token="test_token",
                token_type="Bearer",
                expires_in=3600,
                refresh_token=None,
                scope="https://www.googleapis.com/auth/userinfo.email openid profile",
                id_token=None,
            )
        ),
    )

    monkeypatch.setattr(service, "get_user_info", AsyncMock(return_value=None))

    callback = (
        f"/oauth/google/callback?state={state_token}&code=test_code&scope=email+profile+openid"
    )

    data = client.get(callback, cookies={"oauth_state": oauth_state_cookie}, follow_redirects=False)

    assert data.status_code == 307
    assert "error_message" in data.headers["location"]


@pytest.mark.asyncio
async def test_callback_login_csrf_attack_prevention():
    """
    Test that login CSRF attack is prevented.

    Attack scenario: Attacker initiates OAuth flow, gets their oauth_state cookie,
    then sends the callback URL to victim. Victim's browser won't have the cookie,
    so the attack fails.
    """
    # Attacker initiates OAuth flow
    attacker_cookie, attacker_state = _get_oauth_state_and_token()

    # Attacker crafts callback URL and victim opens it without attacker's cookie
    callback = (
        f"/oauth/google/callback?state={attacker_state}&code=attacker_code&scope=email+profile"
    )

    # Victim doesn't have the oauth_state cookie
    data = client.get(callback, follow_redirects=False)

    assert data.status_code == 307
    assert "error_message" in data.headers["location"]
    # The missing cookie must be what stopped it — any other error would mean
    # the request got as far as exchanging the attacker's code with Google.
    assert "cookie" in data.headers["location"].lower()


@pytest.mark.asyncio
async def test_callback_cross_session_attack_prevention():
    """
    Test that using oauth_state from one session with state token from another fails.
    """
    # User A initiates OAuth flow
    user_a_cookie, user_a_state = _get_oauth_state_and_token("http://localhost:3000/user_a")

    # User B initiates OAuth flow
    user_b_cookie, user_b_state = _get_oauth_state_and_token("http://localhost:3000/user_b")

    # Try to use User A's cookie with User B's state token
    callback = f"/oauth/google/callback?state={user_b_state}&code=test_code&scope=email+profile"

    data = client.get(callback, cookies={"oauth_state": user_a_cookie}, follow_redirects=False)

    assert data.status_code == 307
    assert "error_message" in data.headers["location"]
