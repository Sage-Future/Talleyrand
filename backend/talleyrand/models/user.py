"""
Domain model for User entity.
"""

from pydantic import BaseModel, EmailStr


class User(BaseModel):
    """Domain model for User entity."""

    id: str
    email: EmailStr
    name: str | None = None
    picture: str | None = None
