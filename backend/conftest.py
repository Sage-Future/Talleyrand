"""
Test environment for the backend suite.

`talleyrand.core.config` builds its Settings the moment it is imported, so
every test module that touches the package needs a complete configuration
before pytest can even collect it. Setting one here lets the suite run from a
fresh clone with no .env file and no Google Cloud project, and pins the tests
to a known configuration instead of whatever the developer happens to have
locally.

Environment variables win over the .env file, so anything a test asserts on
must be set here — otherwise the same test passes on the host and fails in
Docker, which sets a different value. These values are placeholders. Nothing in
the suite talks to Google or signs a token anyone outside the test process will
see.
"""

import os

os.environ["JWT_SECRET_KEY"] = "test-only-signing-key-never-use-this-anywhere-real"
os.environ["GOOGLE_CLIENT_ID"] = "test-client-id"
os.environ["GOOGLE_CLIENT_SECRET"] = "test-client-secret"
os.environ["GOOGLE_REDIRECT_URI"] = "http://localhost:8000/auth/google/callback"

# docker compose turns this off so sign-in works over plain HTTP locally. The
# oauth_state cookie is then no longer Secure, the test client starts replaying
# it, and the tests that must send no cookie quietly send one.
os.environ["COOKIE_SECURE"] = "true"
