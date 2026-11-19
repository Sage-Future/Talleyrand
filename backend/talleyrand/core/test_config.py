import pytest
from pydantic import ValidationError

from talleyrand.core.config import Settings


@pytest.mark.parametrize(
    "field, value",
    [("agent_concurrency", 0), ("agent_timeout_seconds", 0), ("agent_timeout_seconds", -1)],
)
def test_agent_limits_that_would_hang_every_call_are_refused(field, value):
    # Zero slots never grants one, and the timeout only starts inside a slot.
    with pytest.raises(ValidationError, match=field):
        Settings(_env_file=None, **{field: value})
