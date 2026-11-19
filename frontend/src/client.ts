import createClient from 'openapi-fetch';
import type { paths } from './api/schema';
import { BACKEND_CONFIG } from './config/constants';

export const isWebSearchEnabled = (): boolean => {
  return localStorage.getItem('web_search_enabled') !== 'false';
};

export type SearchProvider = 'kagi' | 'mixedbread';

// Which service answers search through; each needs its key in backend/.env.
export const getSearchProvider = (): SearchProvider =>
  localStorage.getItem('search_provider') === 'mixedbread' ? 'mixedbread' : 'kagi';

// "Summarize parents": every answer generation also condenses the thread above
// the question into a cheat sheet. Off unless the user turned it on.
export const isParentSummaryEnabled = (): boolean => {
  return localStorage.getItem('summarize_parents') === 'true';
};

export const getVerbosity = (): 'low' | 'medium' => {
  const stored = localStorage.getItem('verbosity');
  return stored === 'normal' ? 'medium' : 'low';
};

const client = createClient<paths>({
  baseUrl: BACKEND_CONFIG.BACKEND_HTTP_URL,
});

/** URL of the per-graph generation-job event stream. */
const jobStreamUrl = (graphId: string): string =>
  `${BACKEND_CONFIG.BACKEND_WS_URL}/research/${graphId}/stream`;

export { client, jobStreamUrl };
