/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "claude_code" or "hermes": the agent ./start-local.sh started the backend on. */
  readonly VITE_AGENT_BACKEND?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
