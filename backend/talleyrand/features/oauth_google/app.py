"""
FastAPI routes for Google OAuth integration.
"""

import logging
from typing import Annotated
from urllib import parse as urlparse

from fastapi import APIRouter, Cookie, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, HttpUrl

from talleyrand.core.config import settings
from talleyrand.features.oauth_google import service
from talleyrand.features.oauth_google.service import OAUTH_STATE_EXPIRE_MINUTES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/oauth/google", tags=["oauth_google"])

OAUTH_STATE_COOKIE = "oauth_state"
OAUTH_STATE_MAX_AGE = OAUTH_STATE_EXPIRE_MINUTES * 60


class GoogleOAuthCallback(BaseModel):
    """DTO for Google OAuth callback."""

    code: str | None = None
    state: str
    scope: str | None = None
    authuser: int | None = None
    prompt: str | None = None
    error: str | None = None


@router.get("/callback")
async def callback(
    callback_data: Annotated[GoogleOAuthCallback, Query()],
    oauth_state: Annotated[str | None, Cookie()] = None,
):
    """
    Handle Google OAuth callback.
    Exchanges authorization code for access token and stores it in cookies.
    Validates state from cookie to prevent CSRF and login CSRF attacks.
    """
    # Handle user cancellation or Google error
    if callback_data.error:
        error_messages = {
            "access_denied": "Access was denied. You may have cancelled the login.",
        }
        message = error_messages.get(
            callback_data.error, f"Authentication error: {callback_data.error}"
        )
        redirect_url = service.add_error_message_to_url(settings.auth_failure_redirect, message)
        response = RedirectResponse(url=redirect_url)
        response.delete_cookie(key=OAUTH_STATE_COOKIE)
        return response

    if not callback_data.code:
        redirect_url = service.add_error_message_to_url(
            settings.auth_failure_redirect, "Missing authorization code."
        )
        response = RedirectResponse(url=redirect_url)
        response.delete_cookie(key=OAUTH_STATE_COOKIE)
        return response

    result = await service.handle_callback(
        callback_code=callback_data.code,
        callback_state=callback_data.state,
        oauth_state_cookie=oauth_state,
    )

    # Append auth code to redirect URL for frontend to exchange for tokens
    redirect_url = result.redirect_url
    if result.auth_code:
        parsed = urlparse.urlparse(redirect_url)
        query = urlparse.parse_qs(parsed.query)
        query["code"] = [result.auth_code]
        redirect_url = urlparse.urlunparse(
            parsed._replace(query=urlparse.urlencode(query, doseq=True))
        )

    response = RedirectResponse(url=redirect_url)

    # Always delete the oauth_state cookie after use
    response.delete_cookie(key=OAUTH_STATE_COOKIE)

    logger.debug(
        "User successfully authenticated via Google OAuth. Redirecting to %s", redirect_url
    )

    return response


class OAuthRedirectRequest(BaseModel):
    """
    Represents a request to redirect a user during the OAuth flow.
    """

    next_url: HttpUrl = Field(description="URL to redirect to after OAuth flow")


@router.get("/redirect_url")
async def redirect_url(
    data: Annotated[OAuthRedirectRequest, Query()],
):
    """
    Redirect user to Google OAuth.
    Sets oauth_state cookie (first-party on backend domain) for CSRF protection,
    then redirects the browser directly to Google's consent page.
    """
    try:
        result = service.create_auth_url(data.next_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    response = RedirectResponse(url=result.redirect_url)

    # Set oauth_state cookie — first-party because the browser navigated here directly
    response.set_cookie(
        key=OAUTH_STATE_COOKIE,
        value=result.oauth_state_cookie,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=OAUTH_STATE_MAX_AGE,
    )

    return response
