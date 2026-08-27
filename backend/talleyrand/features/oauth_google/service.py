"""
Module contains all business logic for Google OAuth integration.
"""

import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib import parse as urlparse

import httpx
import jwt
from pydantic import BaseModel, Field, HttpUrl

from talleyrand.core.config import settings
from talleyrand.features.auth_jwt import service as jwt_service
from talleyrand.models.user import User

logger = logging.getLogger(__name__)

OAUTH_STATE_EXPIRE_MINUTES = 10


class GoogleTokenResponse(BaseModel):
    """DTO for Google OAuth token exchange response."""

    access_token: str = Field(description="Google OAuth access token")
    token_type: str = Field(description="Token type (e.g., 'Bearer')")
    expires_in: int = Field(description="Token expiration time in seconds")
    refresh_token: str | None = Field(None, description="Refresh token if available")
    scope: str | None = Field(None, description="Granted scopes")
    id_token: str | None = Field(None, description="OpenID Connect ID token")


class GoogleUserInfo(BaseModel):
    """DTO for Google user information response."""

    id: str = Field(description="Google user ID")
    email: str = Field(description="User's email address")
    name: str = Field(description="User's full name")
    picture: str | None = Field(None, description="URL to user's profile picture")
    verified_email: bool | None = Field(None, description="Whether email is verified")
    given_name: str | None = Field(None, description="User's given name")
    family_name: str | None = Field(None, description="User's family name")
    locale: str | None = Field(None, description="User's locale")


class ServiceError(Exception):
    """Base exception for OAuth Google service errors."""


class TokenExchangeError(ServiceError):
    """Raised when token exchange with Google fails."""


class UserInfoRetrievalError(ServiceError):
    """Raised when fetching user info from Google fails."""


class GoogleServiceConnectionError(ServiceError):
    """Raised when connection to Google services fails."""


class CreateAuthUrlResult(BaseModel):
    """Result of create_auth_url containing redirect URL and cookie value."""

    redirect_url: str
    oauth_state_cookie: str


def _get_allowed_redirect_hosts() -> set[str]:
    """Extract allowed hosts from CORS origins."""
    allowed_hosts = set()
    for origin in settings.cors_origins:
        parsed = urlparse.urlparse(origin)
        if parsed.hostname:
            allowed_hosts.add(parsed.hostname)
    return allowed_hosts


def _validate_next_url(next_url: HttpUrl) -> bool:
    """Validate that next_url is from an allowed origin."""
    parsed = urlparse.urlparse(str(next_url))
    allowed_hosts = _get_allowed_redirect_hosts()
    return parsed.hostname in allowed_hosts


def create_auth_url(next_url: HttpUrl) -> CreateAuthUrlResult:
    """
    Generates a Google OAuth 2.0 authorization URL with cookie-based CSRF protection.

    Args:
        next_url (HttpUrl): The URL to redirect to after authentication is complete.

    Returns:
        CreateAuthUrlResult: Contains the Google OAuth URL and the signed cookie value.

    Raises:
        ValueError: If next_url is not from an allowed origin.
    """
    if not _validate_next_url(next_url):
        raise ValueError(f"Invalid redirect URL: {next_url}")

    state_token = secrets.token_urlsafe(32)

    # Create signed JWT for oauth_state cookie
    # Note: exp must be a datetime object (not serialized to string) for PyJWT
    jwt_payload = {
        "token": state_token,
        "next": str(next_url),
        "exp": datetime.now(UTC) + timedelta(minutes=OAUTH_STATE_EXPIRE_MINUTES),
    }
    signed_cookie = jwt.encode(
        jwt_payload,
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )

    params: dict[str, Any] = {
        "client_id": settings.google_client_id,
        "redirect_uri": str(settings.google_redirect_uri),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state_token,  # Only the token goes to Google, not the full state
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
    }

    redirect_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlparse.urlencode(params)

    return CreateAuthUrlResult(
        redirect_url=redirect_url,
        oauth_state_cookie=signed_cookie,
    )


async def exchange_code_for_token(code: str) -> GoogleTokenResponse:
    """
    Exchange authorization code for Google OAuth access token.

    Args:
        code: Authorization code from Google OAuth callback

    Returns:
        GoogleTokenResponse containing access_token and other token data

    Raises:
        TokenExchangeError: If token exchange fails
        GoogleServiceConnectionError: If connection to Google fails
    """
    token_request_data = {
        "code": code,
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "redirect_uri": str(settings.google_redirect_uri),
        "grant_type": "authorization_code",
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(str(settings.google_token_url), data=token_request_data)
            response.raise_for_status()
            return GoogleTokenResponse(**response.json())
        except httpx.HTTPStatusError as e:
            raise TokenExchangeError(f"Failed to exchange code for token: {e.response.text}") from e
        except httpx.RequestError as e:
            raise GoogleServiceConnectionError(
                f"Failed to connect to Google OAuth service: {str(e)}"
            ) from e


async def get_user_info(access_token: str) -> GoogleUserInfo:
    """
    Fetch user information from Google using access token.

    Args:
        access_token: Google OAuth access token

    Returns:
        GoogleUserInfo containing user information (id, email, name, etc.)

    Raises:
        UserInfoRetrievalError: If user info retrieval fails
        GoogleServiceConnectionError: If connection to Google fails
    """
    headers = {"Authorization": f"Bearer {access_token}"}

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(str(settings.google_userinfo_url), headers=headers)
            response.raise_for_status()
            return GoogleUserInfo(**response.json())
        except httpx.HTTPStatusError as e:
            raise UserInfoRetrievalError(f"Failed to fetch user info: {e.response.text}") from e
        except httpx.RequestError as e:
            raise GoogleServiceConnectionError(
                f"Failed to connect to Google userinfo service: {str(e)}"
            ) from e


class CallbackResult(BaseModel):
    """
    Response from handle_callback function

    Attributes:
        redirect_url (str): The URL to redirect the user after authentication.
        auth_code (str | None): One-time authorization code for token exchange.
    """

    redirect_url: str
    auth_code: str | None = None


async def handle_callback(
    callback_code: str,
    callback_state: str,
    oauth_state_cookie: str | None,
) -> CallbackResult:
    """
    Handles the OAuth2 callback from Google, performing cookie-based CSRF validation,
    exchanging the authorization code for tokens, retrieving user information,
    and issuing JWT access and refresh tokens.

    Args:
        callback_code (str): The authorization code received from Google OAuth callback.
        callback_state (str): The state token received from Google OAuth callback.
        oauth_state_cookie (str | None): The signed JWT from oauth_state cookie.

    Returns:
        CallbackResult: Contains the redirect URL (with error message if authentication
            fails), and optionally the access and refresh tokens if authentication succeeds.
    """
    # Validate oauth_state cookie exists
    if not oauth_state_cookie:
        logger.info("Missing oauth_state cookie - cookies may be disabled")
        redirect = add_error_message_to_url(
            settings.auth_failure_redirect, "Missing OAuth state. Are cookies enabled?"
        )
        return CallbackResult(redirect_url=redirect)

    # Decode and validate the signed cookie
    try:
        payload = jwt.decode(
            oauth_state_cookie,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
        cookie_token = payload.get("token")
        cookie_next = payload.get("next")
    except jwt.ExpiredSignatureError:
        logger.info("OAuth state cookie expired")
        redirect = add_error_message_to_url(
            settings.auth_failure_redirect, "OAuth session expired. Please try again."
        )
        return CallbackResult(redirect_url=redirect)
    except jwt.PyJWTError as e:
        logger.info("Failed to decode oauth_state cookie: %s", e)
        redirect = add_error_message_to_url(settings.auth_failure_redirect, "Invalid OAuth state.")
        return CallbackResult(redirect_url=redirect)

    # Validate state token matches (prevents CSRF and login CSRF)
    if cookie_token != callback_state:
        logger.info(
            "State mismatch. Cookie token: %s, callback state: %s",
            cookie_token,
            callback_state,
        )
        redirect = add_error_message_to_url(
            settings.auth_failure_redirect, "State mismatch - possible CSRF attack."
        )
        return CallbackResult(redirect_url=redirect)

    # Exchange code for Google OAuth token
    try:
        token_data = await exchange_code_for_token(callback_code)
    except (TokenExchangeError, GoogleServiceConnectionError) as e:
        logger.warning("Token exchange failed: %s", e)
        redirect = add_error_message_to_url(
            settings.auth_failure_redirect, "Authentication failed. Please try again."
        )
        return CallbackResult(redirect_url=redirect)

    if "https://www.googleapis.com/auth/userinfo.email" not in (token_data.scope or ""):
        logger.info("Required email scope not granted by user.")
        redirect = add_error_message_to_url(
            settings.auth_failure_redirect, "Need `email` permission to authorise."
        )
        return CallbackResult(redirect_url=redirect)

    try:
        user_info = await get_user_info(token_data.access_token)
    except (UserInfoRetrievalError, GoogleServiceConnectionError) as e:
        logger.warning("Failed to retrieve user info: %s", e)
        redirect = add_error_message_to_url(
            settings.auth_failure_redirect, "Failed to retrieve user information. Please try again."
        )
        return CallbackResult(redirect_url=redirect)

    if not user_info:
        logger.info("Failed to retrieve user info from token.")
        redirect = add_error_message_to_url(
            settings.auth_failure_redirect, "Access token does not contain user info."
        )
        return CallbackResult(redirect_url=redirect)

    if not user_info.verified_email:
        logger.info("User email is not verified.")
        redirect = add_error_message_to_url(
            settings.auth_failure_redirect, "User email is not verified."
        )
        return CallbackResult(redirect_url=redirect)

    if user_info.email not in settings.email_whitelist and settings.email_whitelist_enabled:
        logger.info("User email %s not in whitelist.", user_info.email)
        redirect = add_error_message_to_url(
            settings.auth_failure_redirect, "Access denied for this email."
        )
        return CallbackResult(redirect_url=redirect)

    user = User(
        id=user_info.id,
        email=user_info.email,
        name=user_info.name,
        picture=user_info.picture,
    )

    auth_code = jwt_service.create_auth_code(user)

    return CallbackResult(redirect_url=cookie_next, auth_code=auth_code)


def add_error_message_to_url(url: str | HttpUrl, message: str):
    """
    Adds an error message to the query parameter "error_message" of the given redrect URL.
    """
    parsed_url = urlparse.urlparse(str(url))

    new_query = urlparse.parse_qs(parsed_url.query).copy()
    new_query["error_message"] = [message]

    parsed_url = parsed_url._replace(query=urlparse.urlencode(new_query, doseq=True))

    return urlparse.urlunparse(parsed_url)
