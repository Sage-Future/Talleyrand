import { createContext } from 'react';

/**
 * Removal handler for insight (lightbulb) highlights; null disables removal,
 * so the mark renders as a plain visual highlight (non-research surfaces).
 */
export const InsightContext = createContext<((insightId: string) => void) | null>(null);
