import type { createBrowserRouter } from 'react-router';
import { casePath, newQuestionPath, questionPath } from './paths';

/**
 * Moving around inside a case *is* browser navigation: every question the user
 * opens becomes a history entry, so Back and Forward (the browser's, the
 * trackpad's, and the app's own buttons) all walk the same trail.
 *
 * Each entry carries its depth inside the case, which is what tells the in-app
 * buttons whether there is anywhere left to go.
 */

type AppRouter = ReturnType<typeof createBrowserRouter>;

let router: AppRouter | null = null;

/** Wired up once, where the router is created. */
export const registerRouter = (instance: AppRouter): void => {
  router = instance;
};

const requireRouter = (): AppRouter => {
  if (!router) throw new Error('Case navigation used before the router was created');
  return router;
};

/** Depth of the entry the user is on. Entries from outside the case start at 0. */
export const currentHistoryDepth = (): number => historyDepthOf(requireRouter().state.location);

export const historyDepthOf = (location: { state: unknown }): number =>
  (location.state as { depth?: number } | null)?.depth ?? 0;

/** Open a question, one step deeper into the history. */
export const pushQuestion = (caseId: string, nodeId: string): void => {
  void requireRouter().navigate(questionPath(caseId, nodeId), {
    state: { depth: currentHistoryDepth() + 1 },
  });
};

/** Open the composer for a new root question, one step deeper. */
export const pushNewQuestion = (caseId: string): void => {
  void requireRouter().navigate(newQuestionPath(caseId), {
    state: { depth: currentHistoryDepth() + 1 },
  });
};

/**
 * Point the current entry at another question without adding a step — used
 * when the case moves the user itself (a deleted question, an aborted one).
 */
export const replaceQuestion = (caseId: string, nodeId: string | null): void => {
  void requireRouter().navigate(nodeId ? questionPath(caseId, nodeId) : casePath(caseId), {
    replace: true,
    state: { depth: currentHistoryDepth() },
  });
};

/** Same as the composer above, but replacing the current entry. */
export const replaceNewQuestion = (caseId: string): void => {
  void requireRouter().navigate(newQuestionPath(caseId), {
    replace: true,
    state: { depth: currentHistoryDepth() },
  });
};

export const historyBack = (): void => {
  void requireRouter().navigate(-1);
};

export const historyForward = (): void => {
  void requireRouter().navigate(1);
};
