// Helper to determine if we should use secure protocols (https/wss)
const isSecure = import.meta.env.VITE_IS_SECURE === 'true';

// Backend URL without protocol (e.g., "localhost:8000" or "api.example.com")
const backendHost = import.meta.env.VITE_BACKEND_URL || 'localhost:8000';

// The public repository, so a visitor can check the open-source claim, star it,
// or self-host without going looking for it.
export const REPO_URL = 'https://github.com/Sage-Future/Talleyrand';

export const BACKEND_CONFIG = {
  // Full HTTP URL for REST API calls
  BACKEND_HTTP_URL: `${isSecure ? 'https' : 'http'}://${backendHost}/backend`,
  // Full WebSocket URL
  BACKEND_WS_URL: `${isSecure ? 'wss' : 'ws'}://${backendHost}/backend`,
};
