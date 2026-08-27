"""
Database setup and connection management for the Talleyrand application.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from talleyrand.core.config import settings

# Global variable to hold the client (initialized at startup)
_mongo_client: AsyncMongoClient[Any] | None = None
_mongo_db: AsyncDatabase[Any] | None = None


@asynccontextmanager
async def lifespan_db() -> AsyncIterator[tuple[AsyncMongoClient[Any], AsyncDatabase[Any]]]:
    """
    Lifespan context manager for MongoDB client.
    Creates client on startup, closes on shutdown.
    """
    global _mongo_client, _mongo_db

    # Startup
    _mongo_client = AsyncMongoClient(str(settings.mongodb_url))
    _mongo_db = _mongo_client[settings.mongodb_database]

    yield _mongo_client, _mongo_db

    # Shutdown
    if _mongo_client:
        _mongo_client.close()
    _mongo_client = None
    _mongo_db = None


def get_db() -> AsyncDatabase[Any]:
    """
    Dependency function that returns the database instance.
    This is called per-request but returns the shared client.
    """
    if _mongo_db is None:
        raise RuntimeError("Database not initialized. Ensure lifespan is configured.")
    return _mongo_db
