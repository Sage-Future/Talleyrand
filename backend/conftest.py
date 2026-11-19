"""
Test environment for the backend suite.

`talleyrand.core.config` builds its Settings the moment it is imported, from
the environment and backend/.env. Environment variables win over the .env
file, so anything a test relies on is pinned here — otherwise the suite would
run against whatever the developer happens to have configured locally.
"""

import os

# The agent the session's own work runs on decides the window it is fitted to.
os.environ["AGENT_BACKEND"] = "claude_code"

# A real key in .env must never reach the suite: Kagi bills every query.
os.environ["KAGI_API_KEY"] = ""
