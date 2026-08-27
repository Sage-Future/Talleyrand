import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './api/schema';
import { UnauthorizedEvent } from './events/UnauthorizedEvent';
import { BACKEND_CONFIG } from './config/constants';
import type { ModelProvider } from './config/models';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from './services/tokenStorage';

const getOpenAIApiKey = (): string | null => {
  return localStorage.getItem('openai_api_key');
};

const getAnthropicApiKey = (): string | null => {
  return localStorage.getItem('anthropic_api_key');
};

/** Forget the model API keys held on this device (signing out). */
export const clearApiKeys = (): void => {
  localStorage.removeItem('openai_api_key');
  localStorage.removeItem('anthropic_api_key');
};

/** Whether the API key a provider's models need is stored on this device. */
export const isProviderKeyConfigured = (provider: ModelProvider): boolean =>
  !!(provider === 'openai' ? getOpenAIApiKey() : getAnthropicApiKey());

export const isWebSearchEnabled = (): boolean => {
  return localStorage.getItem('web_search_enabled') !== 'false';
};

// "Summarize parents": every answer generation also condenses the thread above
// the question into a cheat sheet. Off unless the user turned it on.
export const isParentSummaryEnabled = (): boolean => {
  return localStorage.getItem('summarize_parents') === 'true';
};

export const getVerbosity = (): 'low' | 'medium' => {
  const stored = localStorage.getItem('verbosity');
  return stored === 'normal' ? 'medium' : 'low';
};

const emitUnauthorizedEvent = (nextUrl?: string) => {
  const currentPath = window.location.pathname + window.location.search + window.location.hash;
  const next = nextUrl || encodeURIComponent(window.location.origin + currentPath);
  clearTokens();
  window.dispatchEvent(new UnauthorizedEvent(next));
};

// Track if we're currently refreshing to avoid concurrent refresh calls
let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

const tryRefreshToken = async (): Promise<boolean> => {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return false;
  }

  isRefreshing = true;
  refreshPromise = fetch(`${BACKEND_CONFIG.BACKEND_HTTP_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
    .then(async response => {
      if (response.ok) {
        const data = await response.json();
        setTokens(data.access_token, data.refresh_token);
        return true;
      }
      return false;
    })
    .finally(() => {
      isRefreshing = false;
      refreshPromise = null;
    });

  return refreshPromise;
};

const apiKeyMiddleware: Middleware = {
  async onRequest({ request }) {
    const openaiKey = getOpenAIApiKey();
    if (openaiKey) {
      request.headers.set('X-OpenAI-API-Key', openaiKey);
    }
    const anthropicKey = getAnthropicApiKey();
    if (anthropicKey) {
      request.headers.set('X-Anthropic-API-Key', anthropicKey);
    }
    return request;
  },
};

const bearerTokenMiddleware: Middleware = {
  async onRequest({ request }) {
    const token = getAccessToken();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return request;
  },
};

const retryClones = new WeakMap<Request, Request>();

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    retryClones.set(request, request.clone());
    return request;
  },
  async onResponse({ request, response }) {
    const url = new URL(request.url);
    // Token-minting endpoints must never trigger a refresh attempt themselves.
    const isTokenEndpoint =
      url.pathname.endsWith('/auth/refresh') || url.pathname.endsWith('/auth/token');
    // /auth/me is the startup auth check: refresh applies (an expired access
    // token with a live refresh token must not log the user out), but a failed
    // refresh returns the 401 untouched — AuthContext turns it into the login
    // redirect, and emitting here would re-trigger fetchUser via AuthEventHandler.
    const isAuthCheck = url.pathname.endsWith('/auth/me');

    if (response.status === 401 && !isTokenEndpoint) {
      const refreshed = await tryRefreshToken();

      if (refreshed) {
        const clone = retryClones.get(request);
        if (clone) {
          retryClones.delete(request);
          // Set the new Bearer token on the retried request
          const token = getAccessToken();
          if (token) {
            clone.headers.set('Authorization', `Bearer ${token}`);
          }
          return await fetch(clone);
        }
      } else if (!isAuthCheck) {
        emitUnauthorizedEvent();
      }
    }

    retryClones.delete(request);
    return response;
  },
};

const client = createClient<paths>({
  baseUrl: BACKEND_CONFIG.BACKEND_HTTP_URL,
});
client.use(apiKeyMiddleware);
client.use(bearerTokenMiddleware);
client.use(authMiddleware);

/**
 * URL of the per-graph generation-job event stream.
 *
 * A WebSocket handshake cannot carry an Authorization header, so whatever
 * authenticates the stream sits in the URL — where servers and proxies log it.
 * What goes there is therefore a ticket, not the session token: this request
 * authenticates normally (token in a header) and gets back a credential that
 * opens this one case's stream, expires within seconds, and grants nothing else.
 *
 * Returns null when there is no stream left to open: the case is gone, or the
 * session ended and the app is on its way to the login screen. Every other
 * failure throws, and the caller retries.
 */
const createJobStreamUrl = async (graphId: string): Promise<string | null> => {
  const { data, error, response } = await client.POST('/research/{graph_id}/stream-ticket', {
    params: { path: { graph_id: graphId } },
  });
  if (response.status === 404 || response.status === 401) return null;
  if (error || !data) throw new Error('Could not authorize the live answer stream.');
  const base = `${BACKEND_CONFIG.BACKEND_WS_URL}/research/${graphId}/stream`;
  return `${base}?ticket=${encodeURIComponent(data.ticket)}`;
};

export { client, createJobStreamUrl };
