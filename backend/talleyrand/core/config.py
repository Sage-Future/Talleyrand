"""
Configuration settings for the Talleyrand backend.
Should be split in the future, so that each app registers its own settings.
"""

from pydantic import AnyUrl, EmailStr, Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Settings configuration for the Talleyrand backend.

    Configuration is loaded from environment variables and .env file.
    Environment variables take precedence over .env file values.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # JWT Settings
    jwt_secret_key: str = Field(
        ...,
        description=(
            "Secret key used for signing JWT tokens. "
            "Must be a unique random value per deployment, generated with `openssl rand -hex 32`."
        ),
        min_length=32,
    )
    jwt_algorithm: str = Field(
        default="HS256",
        description="Algorithm used for JWT encoding/decoding",
    )
    jwt_access_token_expire_minutes: int = Field(
        default=1440,
        description="Expiration time for JWT access tokens in minutes",
    )
    jwt_refresh_token_expire_days: int = Field(
        default=7,
        description="Expiration time for JWT refresh tokens in days",
    )

    # Google OAuth Settings
    google_client_id: str = Field(default="", description="Google OAuth client ID", min_length=1)
    google_client_secret: str = Field(
        default="", description="Google OAuth client secret", min_length=1
    )
    google_redirect_uri: HttpUrl = Field(
        ...,
        description="Redirect URI for Google OAuth callbacks",
    )
    google_token_url: HttpUrl = Field(
        default=HttpUrl("https://oauth2.googleapis.com/token"),
        description="URL to obtain Google OAuth tokens",
    )
    google_userinfo_url: HttpUrl = Field(
        default=HttpUrl("https://www.googleapis.com/oauth2/v2/userinfo"),
        description="URL to fetch user info from Google",
    )
    auth_failure_redirect: HttpUrl = Field(
        default=HttpUrl("http://localhost:3000/auth/failure"),
        description="Frontend URL to redirect after successful authentication",
    )

    # CORS Settings
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
        ],
        description="List of allowed CORS origins",
    )

    email_whitelist_enabled: bool = Field(
        default=False,
        description="Whether to enable email whitelist checking",
    )

    email_whitelist: list[EmailStr] = Field(
        default_factory=lambda: [
            "example@example.com",
        ],
        description="List of allowed emails",
    )

    # Cookie Settings (used for oauth_state cookie only)
    cookie_secure: bool = Field(
        default=True,
        description="Whether cookies should be marked as secure",
    )

    mongodb_url: AnyUrl = Field(
        description="MongoDB connection URL",
        default_factory=lambda: AnyUrl("mongodb://localhost"),
    )
    mongodb_database: str = Field(
        default="talleyrand",
        description="Name of the MongoDB database",
    )
    logging_level: str = Field(
        default="INFO",
        description="Logging level for the application",
    )

    query_chunk_size: int = Field(
        default=100,
        description="Chunk size for buffering the LLM responses before frontend delivery",
    )
    stream_idle_timeout_seconds: float = Field(
        default=1000.0,
        description=(
            "Max seconds a generation may wait for the next streamed token before the job is "
            "treated as stalled and failed. Bounds the idle gap (reset on every token), not the "
            "total duration, so long reasoning/web-search pauses are tolerated but a hung "
            "provider stream cannot freeze the job forever."
        ),
    )

    log_llm_requests: bool = Field(
        default=False,
        description="Log full LLM responses to console",
    )


settings = Settings()
