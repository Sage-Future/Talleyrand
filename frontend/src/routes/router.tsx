import { FC, useEffect, ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useNavigate } from 'react-router';
import { LoginPage } from '../components/LoginPage';
import { AuthFailurePage } from '../components/AuthFailurePage';
import { LatestGraphRedirect } from '../components/LatestGraphRedirect';
import { ResearchPage } from '../components/research/ResearchPage';
import { LandingPage } from '../components/LandingPage';
import { SharedCaseViewer } from '../components/SharedCaseViewer';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ConsentBanner } from '../components/ConsentBanner';
import { TooltipLayer } from '../components/ui/TooltipLayer';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { UnauthorizedEvent } from '../events/UnauthorizedEvent';
import { clearTokens } from '../services/tokenStorage';
import { registerRouter } from './caseNavigation';

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

const RootLayout: FC = () => (
  <AuthProvider>
    <AuthEventHandler />
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
