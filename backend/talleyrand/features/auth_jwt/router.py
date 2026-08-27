"""
FastAPI router for JWT authentication and token management.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from talleyrand.features.auth_jwt import service
from talleyrand.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])

security = HTTPBearer(auto_error=False)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenExchangeRequest(BaseModel):
    code: str


@router.post("/token", response_model=TokenResponse)
async def exchange_token(request: TokenExchangeRequest):
    """Exchange a one-time authorization code for access and refresh tokens."""
    try:
        access_token, refresh_token = service.exchange_auth_code(request.code)
    except service.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authorization code",
        ) from exc

    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh_access_token(request: RefreshRequest):
    """Refresh access token using refresh token from request body."""
    try:
        user = service.verify_token(request.refresh_token, token_type="refresh")
    except service.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        ) from exc

    new_access_token = service.create_access_token(user)
    new_refresh_token = service.create_refresh_token(user)

    return TokenResponse(access_token=new_access_token, refresh_token=new_refresh_token)


async def require_auth(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
) -> User:
    """
    FastAPI Dependency that checks for Authorization: Bearer <token>.
    Returns User object if auth successful, otherwise raises HTTP 401.

    A missing header answers 401 like an invalid one, rather than the 403
    FastAPI would send by itself: 401 is the only status the browser reads as
    "this session is over", and a tab whose tokens were cleared elsewhere (a
    sign-out in another tab) must be sent to the login page rather than left
    retrying forever.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        user = service.verify_token(credentials.credentials, token_type="access")
    except service.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token",
        ) from exc

    return user


@router.get("/me", response_model=User)
async def get_current_user(user: Annotated[User, Depends(require_auth)]):
    """
    Get current authenticated user info.
    Used by frontend to check authentication status.
    """
    return user
