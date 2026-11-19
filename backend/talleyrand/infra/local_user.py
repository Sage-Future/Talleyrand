"""
The one person a Talleyrand session acts for: the operator, on their own
machine. There is no sign-in; infra/local_only.py is what keeps everyone else
out.
"""

from talleyrand.core.config import settings
from talleyrand.models.user import User


def current_user() -> User:
    """FastAPI dependency: every request is the operator's."""
    return User(id="local", email=settings.local_user_email, name="Local")
