import { FC, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useGraphStructureStore } from '../../stores/graphStructureStore';
import { useNodeContentStore } from '../../stores/nodeContentStore';
import { useResearchStore } from '../../stores/researchStore';
import { ancestorsOf, buildQuestionTree } from '../../utils/questionTree';
import { ThreadAbove } from './ThreadAbove';
import { CurrentAnswer } from './CurrentAnswer';
import { KickstartModal } from './KickstartModal';
import { ThreadInput } from './ThreadInput';
import { iconTooltip } from '../ui/TooltipLayer';

// Per-cursor scroll positions; switching threads restores the exact spot
const scrollPositions = new Map<string, number>();

export function clearThreadScrollPositions(): void {
  scrollPositions.clear();
}

const QuestionLabel: FC<{ nodeId: string; className?: string; onClick?: () => void }> = ({
  nodeId,
  className = '',
  onClick,
}) => {
  const query = useNodeContentStore(s => s.nodeContents[nodeId]?.query ?? '');
  return (
    <button onClick={onClick} className={className} data-tooltip={query}>
      {query || '(empty question)'}
    </button>
  );
};

const TrailDropdown: FC = () => {
  const [open, setOpen] = useState(false);
  const visitedTrail = useResearchStore(s => s.visitedTrail);
  const cursorNodeId = useResearchStore(s => s.cursorNodeId);
  const visitNode = useResearchStore(s => s.visitNode);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Most recent first, excluding wherever the user already is
  const trail = useMemo(
    () =>
      [...visitedTrail]
        .reverse()
        .filter(nodeId => nodeId !== cursorNodeId)
        .slice(0, 12),
    [visitedTrail, cursorNodeId]
  );

  useLayoutEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={trail.length === 0}
        className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700 disabled:opacity-30"
        {...iconTooltip('Recently visited')}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-30 w-72 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-xl">
          <div className="border-b border-stone-100 bg-stone-50 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-stone-400">
            Recently visited
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {trail.map(nodeId => (
              <QuestionLabel
                key={nodeId}
                nodeId={nodeId}
                onClick={() => {
                  setOpen(false);
                  visitNode(nodeId);
                }}
                className="block w-full truncate px-3 py-1.5 text-left font-serif text-xs text-stone-700 hover:bg-stone-100 hover:text-stone-900"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * The Thread: breadcrumb header with back/forward and the trail, collapsed
 * ancestors, the current Q&A, and the input.
 */
export const ThreadPane: FC = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showKickstart, setShowKickstart] = useState(false);

  const cursorNodeId = useResearchStore(s => s.cursorNodeId);
  const composingRoot = useResearchStore(s => s.composingRoot);
  const canGoBack = useResearchStore(s => s.historyDepth > 0);
  const canGoForward = useResearchStore(s => s.historyDepth < s.historyTop);
  const goBack = useResearchStore(s => s.goBack);
  const goForward = useResearchStore(s => s.goForward);
  const visitNode = useResearchStore(s => s.visitNode);

  const nodes = useGraphStructureStore(s => s.nodes);
  const edges = useGraphStructureStore(s => s.edges);
  const treeEmpty = nodes.length === 0;

  const ancestors = useMemo(() => {
    if (!cursorNodeId) return [];
    const tree = buildQuestionTree(nodes, edges);
    if (!tree.outlineMap.has(cursorNodeId)) return [];
    return ancestorsOf(tree, cursorNodeId);
  }, [nodes, edges, cursorNodeId]);

  // Save scroll position per cursor; restore exactly when switching threads
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || !cursorNodeId) return;
    container.scrollTop = scrollPositions.get(cursorNodeId) ?? 0;
  }, [cursorNodeId]);

  const handleScroll = () => {
    const container = scrollRef.current;
    if (container && cursorNodeId) {
      scrollPositions.set(cursorNodeId, container.scrollTop);
    }
  };

  const breadcrumbPath = cursorNodeId ? [...ancestors, cursorNodeId] : [];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-parchment">
      {/* Header: back/forward, trail, breadcrumb */}
      <div className="flex items-center gap-1 border-b border-stone-200 bg-paper px-3 py-2">
        <button
          onClick={goBack}
          disabled={!canGoBack}
          className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700 disabled:opacity-30"
          {...iconTooltip('Back (⌘[)')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <button
          onClick={goForward}
          disabled={!canGoForward}
          className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700 disabled:opacity-30"
          {...iconTooltip('Forward (⌘])')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <TrailDropdown />
        <div className="mx-1 h-4 w-px bg-stone-200" />
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {breadcrumbPath.map((nodeId, index) => (
            <span key={nodeId} className="flex min-w-0 items-center gap-1">
              {index > 0 && <span className="flex-shrink-0 text-stone-300">›</span>}
              <QuestionLabel
                nodeId={nodeId}
                onClick={nodeId === cursorNodeId ? undefined : () => visitNode(nodeId)}
                className={`max-w-[14rem] truncate font-serif text-xs ${
                  nodeId === cursorNodeId
                    ? 'font-medium text-stone-800'
                    : 'text-stone-400 hover:text-stone-800'
                }`}
              />
            </span>
          ))}
        </div>
      </div>

      {/* Thread body */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-3">
        <div className="mx-auto max-w-3xl">
          {composingRoot && !treeEmpty ? (
            <div className="flex h-full flex-col items-center justify-center py-24 text-center">
              <div className="mb-3 font-serif text-2xl text-stone-800">New question</div>
              <div className="mb-4 h-px w-10 bg-stone-300" />
              <div className="max-w-sm font-serif text-sm leading-relaxed text-stone-500">
                Ask a new question below to start a fresh thread.
              </div>
            </div>
          ) : cursorNodeId ? (
            <>
              <ThreadAbove nodeId={cursorNodeId} ancestorIds={ancestors} />
              <CurrentAnswer
                key={cursorNodeId}
                nodeId={cursorNodeId}
                scrollContainerRef={scrollRef}
              />
            </>
          ) : treeEmpty ? (
            <div className="flex h-full flex-col items-center justify-center py-24 text-center">
              <div className="mb-3 font-serif text-2xl text-stone-800">Open a case</div>
              <div className="mb-4 h-px w-10 bg-stone-300" />
              <div className="max-w-md font-serif text-[15px] leading-relaxed text-stone-500">
                Not sure where to begin? Describe what you're trying to figure out — in your own
                words, however messy — and get a research brief plus a set of starting questions to
                explore.
              </div>
              <button
                onClick={() => setShowKickstart(true)}
                className="mt-8 flex items-center gap-3 rounded-full bg-stone-900 py-4 pl-7 pr-8 font-serif text-[18px] text-stone-50 shadow-[0_4px_20px_rgba(28,25,23,0.25)] transition-all hover:-translate-y-0.5 hover:bg-stone-700 hover:shadow-[0_10px_30px_rgba(28,25,23,0.3)]"
                data-testid="kickstart-open"
              >
                <svg
                  className="icon-optical h-5 w-5 text-orange-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.66 3.5l1.15 2.84 2.84 1.15-2.84 1.15-1.15 2.85-1.15-2.85-2.85-1.15 2.85-1.15L9.66 3.5zM17.5 11l.9 2.23 2.23.9-2.23.9-.9 2.22-.9-2.22-2.22-.9 2.22-.9.9-2.23zM8 15.5l.77 1.9 1.9.77-1.9.77-.77 1.9-.77-1.9-1.9-.77 1.9-.77.77-1.9z"
                  />
                </svg>
                Kick-start with a brief &amp; questions
              </button>
              <div className="mt-5 max-w-sm font-serif text-[13px] text-stone-400">
                Already know your first question? Just ask it below.
              </div>
            </div>
          ) : (
            <div className="py-24 text-center font-serif text-sm text-stone-400">
              Select a question from the tree on the left.
            </div>
          )}
        </div>
      </div>

      <ThreadInput />

      {showKickstart && <KickstartModal onClose={() => setShowKickstart(false)} />}
    </div>
  );
};
