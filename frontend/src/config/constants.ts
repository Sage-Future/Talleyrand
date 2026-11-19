// Helper to determine if we should use secure protocols (https/wss)
const isSecure = import.meta.env.VITE_IS_SECURE === 'true';

// Backend URL without protocol (e.g., "localhost:8000" or "api.example.com")
const backendHost = import.meta.env.VITE_BACKEND_URL || 'localhost:8000';

// Set by ./start-local.sh, alongside the backend's AGENT_BACKEND: the agent
// that runs the session's own work, which the default model follows.
// ponytail: a build-time flag the script keeps in step with the backend; ask
// the backend instead if the two ever get started separately.
export const AGENT_BACKEND = import.meta.env.VITE_AGENT_BACKEND || null;

export const BACKEND_CONFIG = {
  // Full HTTP URL for REST API calls
  BACKEND_HTTP_URL: `${isSecure ? 'https' : 'http'}://${backendHost}/backend`,
  // Full WebSocket URL
  BACKEND_WS_URL: `${isSecure ? 'wss' : 'ws'}://${backendHost}/backend`,
};
