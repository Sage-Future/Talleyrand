import { FC, RefObject, useEffect, useRef } from 'react';
import { isProviderKeyConfigured } from '../../client';
import { modelProvider } from '../../config/models';
import { useNodeContentStore } from '../../stores/nodeContentStore';
import { useResearchStore } from '../../stores/researchStore';
import { useUIStateStore } from '../../stores/uiStateStore';
import { researchGenerationService } from '../../services/researchGenerationService';
import { ThinkingDots } from '../ui/ThinkingDots';
import { AnswerSources } from './AnswerSources';
import { AnswerSuggestions } from './AnswerSuggestions';
import { LovedButton } from './LovedButton';
import { RegenerateButton } from './RegenerateButton';
import { SelectableAnswer } from './SelectableAnswer';

interface CurrentAnswerProps {
  nodeId: string;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

/**
 * The current question and its streaming/streamed answer. This is the only
 * component that re-renders per chunk.
 */
export const CurrentAnswer: FC<CurrentAnswerProps> = ({ nodeId, scrollContainerRef }) => {
  const query = useNodeContentStore(s => s.nodeContents[nodeId]?.query ?? '');
  const parentSelectedText = useNodeContentStore(s => s.nodeContents[nodeId]?.parentSelectedText);
  const response = useNodeContentStore(s => s.nodeContents[nodeId]?.response ?? '');
  const sources = useNodeContentStore(s => s.nodeContents[nodeId]?.sources);
  const sourcesFound = useNodeContentStore(s => s.nodeContents[nodeId]?.sourcesFound);
  const selectedModel = useNodeContentStore(s => s.nodeContents[nodeId]?.selectedModel);
  const streamText = useResearchStore(s => s.streamTexts[nodeId] ?? '');
  const job = useResearchStore(s => s.jobs[nodeId]);
  const settingsOpen = useUIStateStore(s => s.showSettingsModal);
  const setShowSettingsModal = useUIStateStore(s => s.setShowSettingsModal);
  const isRead = useResearchStore(s => s.readHistory.some(event => event.nodeId === nodeId));
  const askQuestion = useResearchStore(s => s.askQuestion);

  const isStreaming = job?.status === 'streaming';
  // Without the key this question's model needs, the generation cannot succeed:
  // adding it — not retrying — is the way out of the error. Re-read whenever the
  // settings modal opens or closes, so a key added there clears this at once.
  const needsApiKey = !settingsOpen && !isProviderKeyConfigured(modelProvider(selectedModel));
  // A first answer still generating can be aborted back to the composer with
  // Esc (a regeneration, on an already-read node, cannot — it keeps its place).
  const canAbort = (isStreaming || job?.status === 'queued') && !isRead;
  // Completed answers live in node content; an in-flight one renders from the
  // job stream and is never part of persisted state.
  const displayedText = response || streamText;

  // A completed answer on screen is a read answer. visitNode covers cursor
  // moves; this covers cursors that land on an answered node without one —
  // legacy graphs and file imports, where the loaded cursor starts unread.
  const showsCompletedAnswer = !job && !!response;
  useEffect(() => {
    if (showsCompletedAnswer) {
      useResearchStore.getState().markRead(nodeId);
    }
  }, [showsCompletedAnswer, nodeId]);

  // Stick to the bottom while streaming, but only when the user is already there
  const wasAtBottomRef = useRef(true);
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      wasAtBottomRef.current =
        container.scrollHeight - container.scrollTop - container.clientHeight < 60;
    };
    handleScroll();
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [scrollContainerRef, nodeId]);

  useEffect(() => {
    if (!isStreaming) return;
    const container = scrollContainerRef.current;
    if (container && wasAtBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [displayedText, isStreaming, scrollContainerRef]);

  return (
    <div className="relative">
      {/* The question, quoting the selection it was asked about */}
      <div className="mt-4 mb-1 flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-stone-900 px-4 py-2.5 font-serif text-[15px] leading-snug text-stone-50">
          {parentSelectedText && (
            <div
              className="mb-1.5 line-clamp-3 border-l-2 border-stone-600 pl-2 text-[12px] italic leading-snug text-stone-400"
              data-tooltip={parentSelectedText}
            >
              {parentSelectedText}
            </div>
          )}
          <div className="whitespace-pre-wrap">{query}</div>
        </div>
      </div>

      {/* The answer */}
      {job?.status === 'error' ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <div className="mb-2 text-sm font-medium text-rose-700">Generation failed</div>
          <div className="mb-3 text-xs text-rose-600">{job.message}</div>
          <div className="flex items-center gap-2">
            {needsApiKey && (
              <button
                onClick={() => setShowSettingsModal(true)}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 transition-colors"
              >
                Add API key
              </button>
            )}
            <button
              onClick={() => researchGenerationService.retry(nodeId)}
              className={
                needsApiKey
                  ? 'rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 transition-colors'
                  : 'rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 transition-colors'
              }
            >
              Retry
            </button>
            <RegenerateButton nodeId={nodeId} />
          </div>
        </div>
      ) : job?.status === 'queued' ? (
        <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white p-4 text-xs text-stone-400">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l2.5 2.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Queued — will generate shortly…
        </div>
      ) : isStreaming && !displayedText ? (
        <div className="rounded-lg border border-stone-200 bg-white">
          <ThinkingDots />
        </div>
      ) : displayedText ? (
        <>
          <SelectableAnswer nodeId={nodeId} />
          {showsCompletedAnswer && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2">
              <RegenerateButton nodeId={nodeId} />
              {/* Keyed so moving to another question never inherits an open list */}
              <AnswerSources key={nodeId} sources={sources ?? []} found={sourcesFound ?? 0} />
              <div className="ml-auto">
                <LovedButton nodeId={nodeId} />
              </div>
            </div>
          )}
          {showsCompletedAnswer && <AnswerSuggestions nodeId={nodeId} />}
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-100/60 p-4 text-center">
          <div className="mb-2 font-serif text-xs text-stone-400">
            This question hasn't been asked yet.
          </div>
          <button
            onClick={() => askQuestion(nodeId)}
            className="rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 transition-colors"
          >
            Ask
          </button>
        </div>
      )}

      {canAbort && (
        <div className="mt-2 px-1 text-[11px] text-stone-400">
          Press{' '}
          <kbd className="rounded border border-stone-300 bg-stone-100 px-1 py-px font-sans text-[10px] text-stone-500">
            Esc
          </kbd>{' '}
          to stop.
        </div>
      )}
    </div>
  );
};
