import { FC, PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from 'react';
import { useGraphStructureStore } from '../../stores/graphStructureStore';
import { useNodeContentStore } from '../../stores/nodeContentStore';
import { useResearchStore } from '../../stores/researchStore';
import { useUIStateStore } from '../../stores/uiStateStore';
import { buildQuestionTree } from '../../utils/questionTree';
import { BriefEditor } from './BriefEditor';
import { FrontierRow } from './FrontierRow';
import { ReportModal } from './ReportModal';
import { iconTooltip } from '../ui/TooltipLayer';

type Row = { nodeId: string; depth: number; ancestors: string[] };

const WIDTH_STORAGE_KEY = 'frontier_width';
const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 280;
const MAX_WIDTH = 900;

function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

function initialWidth(): number {
  const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
  return Number.isFinite(stored) && stored > 0 ? clampWidth(stored) : DEFAULT_WIDTH;
}

/**
 * The Frontier: the case's question tree. Suggestions no longer live
 * here — each question's pending suggestions show as cards under its answer in
 * the thread; a row only carries dots flagging that it has some.
 */
export const FrontierPanel: FC = () => {
  const nodes = useGraphStructureStore(s => s.nodes);
  const edges = useGraphStructureStore(s => s.edges);

  const panelRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [width, setWidth] = useState(initialWidth);

  const startNewRootQuestion = useResearchStore(s => s.startNewRootQuestion);
  // A big-picture pass runs case-wide (no parent node), so its progress
  // belongs here rather than under any single answer.
  const isGeneratingBigPicture = useResearchStore(s =>
    Object.values(s.suggestionJobs).some(target => target === null)
  );

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !panelRef.current) return;
    setWidth(clampWidth(event.clientX - panelRef.current.getBoundingClientRect().left));
  };

  const endResize = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
  };

  const resetWidth = () => {
    setWidth(DEFAULT_WIDTH);
    localStorage.setItem(WIDTH_STORAGE_KEY, String(DEFAULT_WIDTH));
  };

  const rows = useMemo(() => {
    const tree = buildQuestionTree(nodes, edges);

    const result: Row[] = [];
    const walk = (nodeId: string, depth: number, ancestors: string[]) => {
      result.push({ nodeId, depth, ancestors });
      const childAncestors = [...ancestors, nodeId];
      for (const childId of tree.childrenMap.get(nodeId) ?? []) {
        walk(childId, depth + 1, childAncestors);
      }
    };
    tree.rootIds.forEach(rootId => walk(rootId, 0, []));
    return result;
  }, [nodes, edges]);

  const name = useGraphStructureStore(s => s.name);
  const showSidebar = useUIStateStore(s => s.showSidebar);
  const setShowSidebar = useUIStateStore(s => s.setShowSidebar);

  // A report needs at least one answered question to summarize
  const hasAnswers = useNodeContentStore(s =>
    Object.values(s.nodeContents).some(content => content.response)
  );
  const [showReport, setShowReport] = useState(false);

  return (
    <div
      ref={panelRef}
      style={{ width: `${width}px` }}
      className="relative flex h-full flex-shrink-0 flex-col border-r border-stone-200 bg-paper"
    >
      {/* Resize handle straddling the right border */}
      <div
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onLostPointerCapture={endResize}
        onDoubleClick={resetWidth}
        className="absolute -right-[3px] top-0 z-10 h-full w-1.5 cursor-col-resize touch-none transition-colors hover:bg-stone-300/70 active:bg-stone-400/80"
        data-tooltip="Drag to resize — double-click to reset"
      />
      <div className="flex h-12 flex-shrink-0 items-center gap-1.5 border-b border-stone-200 pl-2 pr-3">
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          className="flex-shrink-0 rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700"
          {...iconTooltip(showSidebar ? 'Hide cases' : 'Your cases')}
        >
          <svg
            className={`h-4 w-4 transition-transform ${showSidebar ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <span
          className="min-w-0 flex-1 truncate font-serif text-[15px] font-medium text-stone-800"
          data-tooltip={name ?? undefined}
        >
          {name || 'Untitled case'}
        </span>
        {isGeneratingBigPicture && (
          <span
            className="flex flex-shrink-0 items-center text-violet-500"
            data-tooltip="Looking for big-picture questions across your case"
          >
            <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
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
          </span>
        )}
        <button
          onClick={() => setShowReport(true)}
          disabled={!hasAnswers}
          className="flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 font-serif text-[13px] text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 disabled:cursor-not-allowed disabled:text-stone-300 disabled:hover:bg-transparent"
          data-tooltip={hasAnswers ? 'Generate a report of this case' : 'Answer a question first'}
        >
          <svg
            className="icon-optical h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
          Report
        </button>
      </div>
      <BriefEditor />
      <div className="flex-1 overflow-y-auto py-1.5 pl-1 pr-1.5">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center font-serif text-xs text-stone-400">
            No questions yet. Ask your first question on the right.
          </div>
        ) : (
          rows.map(row => (
            <FrontierRow
              key={row.nodeId}
              nodeId={row.nodeId}
              depth={row.depth}
              ancestors={row.ancestors}
            />
          ))
        )}

        {/* Start a fresh root-level thread, like a kickstart question */}
        <button
          onClick={startNewRootQuestion}
          className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 font-serif text-[13px] text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700"
          data-tooltip="Ask a new root question"
          data-testid="new-root-question"
        >
          <svg
            className="icon-optical w-3.5 h-3.5 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New question
        </button>
      </div>

      {showReport && <ReportModal onClose={() => setShowReport(false)} />}
    </div>
  );
};
