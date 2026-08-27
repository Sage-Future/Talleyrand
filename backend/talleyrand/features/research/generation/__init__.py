"""
Durable generation jobs: server-owned LLM answer and suggestion generation.

Jobs run to completion regardless of client connections and persist their
results as job records. Records are the authoritative source for a result
from completion until the owning client acknowledges incorporation; every
graph read and save applies them as an overlay, so a stale client can never
clobber a server-side result.
"""
