import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  FC,
  ReactNode,
} from 'react';
import { client } from '../client';
import { BACKEND_CONFIG } from '../config/constants';
import { setTokens } from '../services/tokenStorage';
import type { components } from '../api/schema';

type User = components['schemas']['User'];

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  refetch: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Exchange a one-time auth code from the URL (placed there by OAuth callback)
 * for access/refresh tokens. Must complete before the auth check so that
 * ProtectedRoute doesn't redirect to /login prematurely.
 *
 * Uses a module-level promise to survive React StrictMode's double-invocation
 * of effects: the second call waits for the first exchange instead of
 * consuming the one-time code a second time.
 */
let exchangePromise: Promise<void> | null = null;

async function exchangeAuthCodeIfPresent(): Promise<void> {
  if (exchangePromise) {
    await exchangePromise;
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return;

  // Clean the code from URL immediately (before await) so that any
  // concurrent caller that bypasses the promise check also sees no code.
  params.delete('code');
  const newUrl = params.toString()
    ? `${window.location.pathname}?${params}`
    : window.location.pathname;
  window.history.replaceState({}, '', newUrl);

  exchangePromise = (async () => {
    try {
      const res = await fetch(`${BACKEND_CONFIG.BACKEND_HTTP_URL}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        const data = await res.json();
        setTokens(data.access_token, data.refresh_token);
      }
    } catch (err) {
      console.error('Auth code exchange failed:', err);
    }
  })();

  await exchangePromise;
  exchangePromise = null;
}

export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    setIsLoading(true);

    // Exchange auth code first (no-op if no code in URL)
    await exchangeAuthCodeIfPresent();

    try {
      const { data, error } = await client.GET('/auth/me');
      if (error || !data) {
        setUser(null);
      } else {
        setUser(data);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      refetch: fetchUser,
    }),
    [user, isLoading, fetchUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
