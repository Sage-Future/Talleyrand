import { FC } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { LatestGraphRedirect } from '../components/LatestGraphRedirect';
import { ResearchPage } from '../components/research/ResearchPage';
import { TooltipLayer } from '../components/ui/TooltipLayer';
import { registerRouter } from './caseNavigation';

const RootLayout: FC = () => (
  <>
    <Outlet />
    <TooltipLayer />
  </>
);

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      // The case-less view, where a case that fails to load lands: sending it
      // to /research instead could reopen the same case and fail again.
      { path: '/', element: <ResearchPage /> },
      { path: '/research', element: <LatestGraphRedirect /> },
      {
        // One route, question optional: opening a question inside a case swaps
        // the last segment without tearing the case view down and reloading it.
        path: '/research/:graphId/:questionId?',
        element: <ResearchPage />,
      },
      { path: '*', element: <Navigate to="/research" replace /> },
    ],
  },
]);

registerRouter(router);
