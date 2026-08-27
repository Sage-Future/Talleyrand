import { FC } from 'react';
import { useNodeContentStore } from '../../stores/nodeContentStore';
import { useResearchStore } from '../../stores/researchStore';

export type QuestionState =
  | 'streaming'
  | 'queued'
  | 'error'
  | 'open'
  | 'ready'
  | 'resolved'
  | 'read';

/**
 * Derives a question's lifecycle state, in priority order:
 * job states → open → ready → resolved → read.
 *
 * Shared by the frontier rows and the cross-link chips so both surfaces show
 * the identical indicator. Accepts null (chip targets can fail to resolve);
 * callers don't render the indicator in that case.
 */
export function useQuestionState(nodeId: string | null): QuestionState {
  const answered = useNodeContentStore(s => (nodeId ? !!s.nodeContents[nodeId]?.response : false));
  const resolved = useNodeContentStore(s =>
    nodeId ? !!s.nodeContents[nodeId]?.resolvedAt : false
  );
  const jobStatus = useResearchStore(s => (nodeId ? (s.jobs[nodeId]?.status ?? null) : null));
  const isRead = useResearchStore(s =>
    nodeId ? s.readHistory.some(event => event.nodeId === nodeId) : false
  );

  if (jobStatus) return jobStatus;
  if (!answered) return 'open';
  if (!isRead) return 'ready';
  return resolved ? 'resolved' : 'read';
}

export const QuestionStateIcon: FC<{ state: QuestionState }> = ({ state }) => {
  switch (state) {
    case 'streaming':
      return (
        <svg className="w-3.5 h-3.5 animate-spin text-orange-600" fill="none" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      );
    case 'queued':
      return (
        <svg
          className="w-3.5 h-3.5 text-stone-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l2.5 2.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    case 'error':
      return (
        <svg
          className="w-3.5 h-3.5 text-rose-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v3m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    case 'open':
      return (
        <svg
          className="w-3.5 h-3.5 text-stone-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="8" strokeWidth={2} />
        </svg>
      );
    case 'ready':
      return (
        <svg className="w-3.5 h-3.5 text-orange-600" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="6" />
        </svg>
      );
    case 'resolved':
      return (
        <svg
          className="w-3.5 h-3.5 text-stone-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    case 'read':
      return (
        <svg className="w-3.5 h-3.5 text-stone-400" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
  }
};
