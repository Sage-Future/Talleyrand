from urllib.parse import parse_qs, urlparse

import jwt
from fastapi import FastAPI
from fastapi.testclient import TestClient

from talleyrand.core.config import settings

from .app import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def test_get_redirect_url_invalid_query():
    response = client.get("/oauth/google/redirect_url", follow_redirects=False)
    assert response.status_code == 422


def test_get_redirect_url():
    response = client.get(
        "/oauth/google/redirect_url?next_url=http://localhost:3000/home",
        follow_redirects=False,
    )
    assert response.status_code == 307

    location = response.headers["location"]
    assert "https://accounts.google.com/o/oauth2/v2/auth" in location

    qs_data = parse_qs(urlparse(location).query)

    assert qs_data["client_id"] == [settings.google_client_id]
    assert qs_data["redirect_uri"] == [str(settings.google_redirect_uri)]
    assert qs_data["response_type"] == ["code"]
    assert qs_data["scope"] == ["openid email profile"]
    assert qs_data["access_type"] == ["offline"]
    assert qs_data["include_granted_scopes"] == ["true"]
    assert qs_data["prompt"] == ["consent"]

    # State should be a simple token now, not JSON
    assert len(qs_data["state"]) == 1
    state_token = qs_data["state"][0]
    assert len(state_token) > 20  # Should be a secure random token


def test_get_redirect_url_sets_oauth_state_cookie():
    response = client.get(
        "/oauth/google/redirect_url?next_url=http://localhost:3000/home",
        follow_redirects=False,
    )
    assert response.status_code == 307

    # Check oauth_state cookie is set
    assert "oauth_state" in response.cookies

    # Decode and verify cookie contents
    cookie_value = response.cookies["oauth_state"]
    payload = jwt.decode(cookie_value, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])

    assert "token" in payload
    assert payload["next"] == "http://localhost:3000/home"
    assert "exp" in payload

    # Verify state in URL matches token in cookie
    location = response.headers["location"]
    qs_data = parse_qs(urlparse(location).query)
    assert qs_data["state"][0] == payload["token"]


def test_get_redirect_url_missing_next_url():
    response = client.get("/oauth/google/redirect_url", follow_redirects=False)
    assert response.status_code == 422


def test_get_redirect_url_invalid_next_url():
    response = client.get(
        "/oauth/google/redirect_url?next_url=not-a-valid-url",
        follow_redirects=False,
    )
    assert response.status_code == 422


def test_get_redirect_url_disallowed_next_url():
    # next_url not in CORS origins should be rejected
    response = client.get(
        "/oauth/google/redirect_url?next_url=http://evil.com/steal",
        follow_redirects=False,
    )
    assert response.status_code == 400


def test_redirect_url_contains_all_required_params():
    response = client.get(
        "/oauth/google/redirect_url?next_url=http://localhost:3000/home",
        follow_redirects=False,
    )
    assert response.status_code == 307

    location = response.headers["location"]

    # Check all required OAuth params are present
    assert "client_id=" in location
    assert "redirect_uri=" in location
    assert "response_type=code" in location
    assert "scope=" in location
    assert "state=" in location
    assert "access_type=offline" in location
    assert "include_granted_scopes=true" in location
    assert "prompt=consent" in location


def test_redirect_url_with_long_next_url():
    long_path = "/path/" + "x" * 500
    next_url = f"http://localhost:3000{long_path}"
    response = client.get(
        f"/oauth/google/redirect_url?next_url={next_url}",
        follow_redirects=False,
    )
    assert response.status_code == 307

    # Verify next_url is preserved in cookie
    cookie_value = response.cookies["oauth_state"]
    payload = jwt.decode(cookie_value, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    assert payload["next"] == next_url


def test_redirect_url_with_query_params_in_next_url():
    next_url = "http://localhost:3000/home?param1=value1&param2=value2"
    response = client.get(
        "/oauth/google/redirect_url",
        params={"next_url": next_url},
        follow_redirects=False,
    )
    assert response.status_code == 307

    # Verify next_url with query params is preserved
    cookie_value = response.cookies["oauth_state"]
    payload = jwt.decode(cookie_value, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    assert payload["next"] == next_url
