import { FC, useEffect, ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { LoginPage } from '../components/LoginPage';
import { AuthFailurePage } from '../components/AuthFailurePage';
import { LatestGraphRedirect } from '../components/LatestGraphRedirect';
import { ResearchPage } from '../components/research/ResearchPage';
import { LandingPage } from '../components/LandingPage';
import { SharedCaseViewer } from '../components/SharedCaseViewer';
import { PrivacyPage } from '../components/legal/PrivacyPage';
import { TermsPage } from '../components/legal/TermsPage';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ConsentBanner } from '../components/ConsentBanner';
import { TooltipLayer } from '../components/ui/TooltipLayer';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { UnauthorizedEvent } from '../events/UnauthorizedEvent';
import { clearTokens } from '../services/tokenStorage';
import { registerRouter } from './caseNavigation';
import { SITE_URL } from '../config/constants';

// Component to handle auth events
const AuthEventHandler: FC = () => {
  const navigate = useNavigate();
  const { refetch } = useAuth();

  useEffect(() => {
    const handleUnauthorized = (event: Event) => {
      const unauthorizedEvent = event as UnauthorizedEvent;
      clearTokens();
      refetch();
      navigate(`/login/?next_url=${unauthorizedEvent.nextUrl}`, { replace: true });
    };

    window.addEventListener(UnauthorizedEvent.EVENT_NAME, handleUnauthorized);

    return () => {
      window.removeEventListener(UnauthorizedEvent.EVENT_NAME, handleUnauthorized);
    };
  }, [navigate, refetch]);

  return null;
};

// Protected route wrapper
const ProtectedRoute: FC<{ children: ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

/**
 * Points the canonical link at the address actually being viewed.
 *
 * index.html can only ship one canonical, and leaving every route claiming to
 * be the home page would fold shared cases and the legal pages into it. The
 * path alone is canonical: query strings here are round-trip state (?next_url
 * after a sign-in bounce), never a different document.
 */
const CanonicalLink: FC = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) return;
    // Keep the root as "/", and drop the trailing slash everywhere else so one
    // page is never claimed under two addresses.
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';
    link.href = `${SITE_URL}${path}`;
  }, [pathname]);

  return null;
};

const RootLayout: FC = () => (
  <AuthProvider>
    <AuthEventHandler />
    <CanonicalLink />
    <Outlet />
    <TooltipLayer />
    <ConsentBanner />
  </AuthProvider>
);

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <LandingPage /> },
      { path: '/privacy', element: <PrivacyPage /> },
      { path: '/terms', element: <TermsPage /> },
      {
        path: '/login',
        element: (
          <ErrorBoundary>
            <LoginPage />
          </ErrorBoundary>
        ),
      },
      {
        path: '/auth/failure',
        element: (
          <ErrorBoundary>
            <AuthFailurePage />
          </ErrorBoundary>
        ),
      },
      {
        path: '/research',
        element: (
          <ProtectedRoute>
            <LatestGraphRedirect />
          </ProtectedRoute>
        ),
      },
      {
        // One route, question optional: opening a question inside a case swaps
        // the last segment without tearing the case view down and reloading it.
        path: '/research/:graphId/:questionId?',
        element: (
          <ProtectedRoute>
            <ResearchPage />
          </ProtectedRoute>
        ),
      },
      {
        path: '/shared/:graphId',
        element: (
          <ErrorBoundary>
            <SharedCaseViewer />
          </ErrorBoundary>
        ),
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

registerRouter(router);
