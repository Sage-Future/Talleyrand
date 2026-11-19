"""
Configuration settings for the Talleyrand backend.
Should be split in the future, so that each app registers its own settings.
"""

from typing import Literal

from pydantic import AnyUrl, EmailStr, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# The one frontend a session serves (start-local.sh runs it here).
LOCAL_FRONTEND_ORIGIN = "http://localhost:3000"


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

    local_user_email: EmailStr = Field(
        default="local@example.com",
        description=(
            "Who the session acts as. Cases belong to an email, so setting this to the "
            "address you signed in with on a hosted Talleyrand opens the cases you had there."
        ),
    )
    agent_backend: Literal["claude_code", "hermes"] = Field(
        default="claude_code",
        description=(
            "The signed-in agent CLI that runs kickstart, suggestions, summaries, reports "
            "and naming. Answers run on whichever agent the question's model names."
        ),
    )
    claude_code_executable: str = Field(default="claude", description="The `claude` CLI to run")
    claude_code_model: str = Field(
        default="sonnet",
        description=(
            "Model passed to `claude --model` for the agent's own work (kickstart, "
            "suggestions, summaries, reports, naming); answers run the model they name"
        ),
    )
    claude_code_effort: str = Field(
        default="medium",
        description="Effort level passed to `claude --effort` for every Claude Code call",
    )
    hermes_executable: str = Field(default="hermes", description="The `hermes` CLI to run")
    hermes_provider: str = Field(
        default="openai-codex",
        description="Hermes provider every Hermes call is pinned to (openai-codex: a ChatGPT plan)",
    )
    hermes_model: str = Field(
        default="gpt-6-astra",
        description=(
            "Model passed to `hermes chat --model` for the agent's own work; answers run "
            "the model they name"
        ),
    )
    hermes_reasoning: str = Field(
        default="medium",
        description="Reasoning effort passed to `hermes chat --reasoning` for every Hermes call",
    )
    kagi_api_key: str = Field(
        default="",
        description=(
            "Kagi Search API key, for answers searching through Kagi (billed per query); "
            "without it they say search is unavailable."
        ),
    )
    mixedbread_api_key: str = Field(
        default="",
        description=(
            "Mixedbread API key, for answers searching through Mixedbread's web store "
            "(billed per search); without it they say search is unavailable."
        ),
    )
    agent_timeout_seconds: float = Field(
        default=900.0,
        gt=0,
        description="Longest one agent CLI call may run before it is killed",
    )
    agent_concurrency: int = Field(
        default=2,
        ge=1,
        description=(
            "How many agent CLI calls may run at once, across backends. They draw on "
            "subscription usage windows."
        ),
    )


settings = Settings()
