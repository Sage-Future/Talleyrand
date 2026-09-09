import {
  FC,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { copySharedGraph, fetchSharedGraph, type SharedGraphData } from '../services/shareService';
import { ancestorsOf, buildQuestionTree, type QuestionTree } from '../utils/questionTree';
import { AnswerSources } from './research/AnswerSources';
import { QuestionStateIcon, type QuestionState } from './ui/QuestionStateIcon';
import { HighlightableMarkdown } from './ui/HighlightableMarkdown';
import { extractBlocks } from './ui/HighlightableMarkdown/blockExtractor';
import {
  highlightsToAnnotations,
  selectionsToAnnotations,
} from './ui/HighlightableMarkdown/selectionToAnnotation';
import {
  DeletedQuestionRefChip,
  QuestionRefChip,
  type QuestionRefProps,
} from './ui/HighlightableMarkdown/QuestionRef';
import type { NodeContent, ResearchSuggestion } from '../types';

type LoadState = 'loading' | 'loaded' | 'not_found';

/**
 * Lifecycle state without the owner's private signals: no jobs run here and
 * read history isn't shared, so states reduce to open / read / resolved.
 */
function questionState(content: NodeContent | undefined): QuestionState {
  if (!content?.response) return 'open';
  return content.resolvedAt ? 'resolved' : 'read';
}

/**
 * The shared page renders with local state instead of the research stores, so
 * the pieces the markdown pipeline needs (chip resolution, navigation) travel
 * through this context rather than through zustand.
 */
interface SharedCaseNav {
  contentById: Map<string, NodeContent>;
  openQuestion: (nodeId: string) => void;
  hoverQuestion: (nodeId: string | null) => void;
}

const SharedCaseNavContext = createContext<SharedCaseNav | null>(null);

/**
 * Cross-link chip for [[<node id>]] tokens — the shared-page stand-in for the
 * research view's QuestionRef, resolving against the fetched case instead of
 * the stores. A ref whose question was deleted before sharing renders as the
 * inert tombstone; anything else unresolvable renders as its literal text.
 */
const SharedQuestionRef: FC<QuestionRefProps> = ({ refNodeId, children }) => {
  const nav = useContext(SharedCaseNavContext);
  const target = refNodeId ? nav?.contentById.get(refNodeId) : undefined;

  if (!nav || !refNodeId) {
    return <>{children}</>;
  }

  if (!target?.query) {
    return <DeletedQuestionRefChip sourceLength={`[[${refNodeId}]]`.length} />;
  }

  return (
    <QuestionRefChip
      query={target.query}
      state={questionState(target)}
      sourceLength={`[[${refNodeId}]]`.length}
      onClick={() => nav.openQuestion(refNodeId)}
      onMouseEnter={() => nav.hoverQuestion(refNodeId)}
      onMouseLeave={() => nav.hoverQuestion(null)}
    />
  );
};

/**
 * An answer rendered exactly like the research view renders one: the white
 * card, the same markdown pipeline with cross-link chips, asked-about and
 * insight markers, and KaTeX — minus the interactive layers (selection popup,
 * regenerate, heart).
 */
const SharedAnswer: FC<{ content: NodeContent }> = ({ content }) => {
  const annotations = useMemo(() => {
    const blocks = extractBlocks(content.response);
    return [
      ...selectionsToAnnotations(content.selections ?? [], blocks, 'child-selection'),
      ...highlightsToAnnotations(content.highlights ?? [], blocks),
    ];
  }, [content]);

  return (
    <div className="relative font-serif">
      <div className="overflow-y-auto rounded border border-gray-200 bg-white p-4">
        <div className="prose prose-lg max-w-none select-text text-base">
          <HighlightableMarkdown
            content={content.response}
            annotations={annotations}
            questionRefComponent={SharedQuestionRef}
          />
        </div>
      </div>
    </div>
  );
};

/**
 * A collapsed ancestor question above the current thread, like the research
 * view's AncestorItem: clicking anywhere on the row — chevron or question text
 * — expands the answer inline.
 */
const SharedAncestorItem: FC<{ content: NodeContent }> = ({ content }) => {
  const [expanded, setExpanded] = useState(false);
  const query = content.query || '(empty question)';
  const truncatedQuery = query.length > 500 ? `${query.slice(0, 500)}…` : query;

  return (
    <div className="border-b border-stone-200/70 py-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="group flex w-full items-start gap-1 text-left"
        data-tooltip={expanded ? 'Collapse answer' : 'Show answer'}
      >
        <span className="mt-1 flex-shrink-0 rounded p-0.5 text-stone-300 transition-colors group-hover:text-stone-500">
          <svg
            className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </span>
        <span className="min-w-0 flex-1 font-serif text-[15px] font-medium text-stone-500 transition-colors group-hover:text-stone-900">
          {truncatedQuery}
        </span>
      </button>
      {expanded && (
        <div className="mb-3 mt-1.5">
          {content.response ? (
            <SharedAnswer content={content} />
          ) : (
            <span className="text-xs text-stone-400">Not answered yet.</span>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * The pending suggestions under an answer, as the research view shows them —
 * the same cards, big-picture first — but read-only: judging them belongs to
 * whoever copies the case.
 */
const SharedSuggestions: FC<{ suggestions: ResearchSuggestion[] }> = ({ suggestions }) => {
  const sorted = useMemo(
    () => [...suggestions].sort((a, b) => Number(b.bigPicture) - Number(a.bigPicture)),
    [suggestions]
  );

  if (sorted.length === 0) return null;

  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-stone-400">
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.66 3.5l1.15 2.84 2.84 1.15-2.84 1.15-1.15 2.85-1.15-2.85-2.85-1.15 2.85-1.15L9.66 3.5zM17.5 11l.9 2.23 2.23.9-2.23.9-.9 2.22-.9-2.22-2.22-.9 2.22-.9.9-2.23zM8 15.5l.77 1.9 1.9.77-1.9.77-.77 1.9-.77-1.9-1.9-.77 1.9-.77.77-1.9z"
          />
        </svg>
        Suggested questions
      </div>
      <div className="flex flex-col gap-1.5">
        {sorted.map(suggestion => (
          <div
            key={suggestion.id}
            className={`rounded-xl border px-3 py-2 ${
              suggestion.bigPicture
                ? 'border-violet-300 bg-violet-50/70 shadow-sm'
                : 'border-stone-200 bg-paper'
            }`}
          >
            <span
              className={`font-serif text-[13.5px] leading-snug ${
                suggestion.bigPicture ? 'text-stone-700' : 'text-stone-600'
              }`}
            >
              {suggestion.text}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 font-serif text-[11px] text-stone-400">
        Follow-ups proposed but not yet explored — copy the case to pursue them.
      </div>
    </div>
  );
};

interface SharedFrontierRowProps {
  content: NodeContent | undefined;
  depth: number;
  isCursor: boolean;
  isRefHovered: boolean;
  suggestionCount: number;
  hasBigPictureSuggestion: boolean;
  onSelect: () => void;
}

/** A frontier row without the owner-only hover actions (ask, resolve, delete). */
const SharedFrontierRow: FC<SharedFrontierRowProps> = ({
  content,
  depth,
  isCursor,
  isRefHovered,
  suggestionCount,
  hasBigPictureSuggestion,
  onSelect,
}) => {
  const state = questionState(content);
  const countTone = hasBigPictureSuggestion
    ? isCursor
      ? 'text-violet-300'
      : 'text-violet-500'
    : 'text-stone-400';

  return (
    <button
      onClick={onSelect}
      className={`relative my-px flex w-full cursor-pointer items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left transition-colors ${
        isCursor ? 'bg-stone-900' : isRefHovered ? 'bg-orange-100/70' : 'hover:bg-stone-200/60'
      } ${isRefHovered ? 'ring-2 ring-inset ring-orange-300/80' : ''} ${
        state === 'resolved' ? 'opacity-50' : ''
      }`}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
      data-tooltip={content?.query}
    >
      {Array.from({ length: depth }).map((_, level) => (
        <span
          key={level}
          aria-hidden
          className={`pointer-events-none absolute -bottom-px -top-px w-px ${
            isCursor ? 'bg-stone-700' : 'bg-stone-300'
          }`}
          style={{ left: `${15 + level * 16}px` }}
        />
      ))}
      <span className="flex-shrink-0">
        <QuestionStateIcon state={state} />
      </span>
      <span
        className={`min-w-0 flex-1 truncate font-serif text-[13px] ${
          isCursor ? 'font-medium text-stone-50' : 'text-stone-700'
        }`}
      >
        {content?.query || '(empty question)'}
      </span>
      {suggestionCount > 0 && (
        <span
          className={`flex-shrink-0 text-[11px] tabular-nums ${countTone}`}
          data-tooltip={
            hasBigPictureSuggestion
              ? `${suggestionCount} suggested ${suggestionCount === 1 ? 'question' : 'questions'}, including a big-picture one`
              : `${suggestionCount} suggested ${suggestionCount === 1 ? 'question' : 'questions'}`
          }
        >
          {suggestionCount}
        </span>
      )}
    </button>
  );
};

/**
 * Public read-only view of a shared case, laid out like the research
 * workspace: the frontier tree and brief on the left, the thread with its
 * white answer cards on the right. Everything owner-only — asking, judging
 * suggestions, regenerating, resolving — is absent; copying clones the whole
 * case (brief, documents, open suggestions and declines included) into the
 * visitor's collection so they can continue the work.
 */
export const SharedCaseViewer: FC = () => {
  const { graphId } = useParams<{ graphId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [data, setData] = useState<SharedGraphData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Question whose row the tree highlights because a cross-link chip is hovered
  const [hoveredRefId, setHoveredRefId] = useState<string | null>(null);
  const [isCopying, setIsCopying] = useState(false);

  // Save scroll position per question; restore exactly when switching threads
  // (same behavior as the research view's ThreadPane)
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || !selectedId) return;
    container.scrollTop = scrollPositions.current.get(selectedId) ?? 0;
  }, [selectedId]);

  const handleScroll = () => {
    const container = scrollRef.current;
    if (container && selectedId) {
      scrollPositions.current.set(selectedId, container.scrollTop);
    }
  };

  // Navigation unmounts the hovered chip before its mouse-leave can fire —
  // clear the highlight as part of moving.
  const selectQuestion = useCallback((nodeId: string) => {
    setHoveredRefId(null);
    setSelectedId(nodeId);
  }, []);

  useEffect(() => {
    if (!graphId) return;
    setLoadState('loading');
    setData(null);
    setSelectedId(null);
    fetchSharedGraph(graphId)
      .then(fetched => {
        setData(fetched);
        setSelectedId(buildQuestionTree(fetched.nodes, fetched.edges).dfsOrder[0] ?? null);
        setLoadState('loaded');
      })
      .catch(() => setLoadState('not_found'));
  }, [graphId]);

  const tree = useMemo(() => (data ? buildQuestionTree(data.nodes, data.edges) : null), [data]);
  const contentById = useMemo(
    () => new Map((data?.nodeContents ?? []).map(content => [content.id, content])),
    [data]
  );
  const rows = useMemo(() => {
    if (!tree) return [];
    const result: { nodeId: string; depth: number }[] = [];
    const walk = (nodeId: string, depth: number) => {
      result.push({ nodeId, depth });
      for (const childId of tree.childrenMap.get(nodeId) ?? []) {
        walk(childId, depth + 1);
      }
    };
    tree.rootIds.forEach(rootId => walk(rootId, 0));
    return result;
  }, [tree]);

  const suggestionKinds = useMemo(() => {
    const map = new Map<string, { count: number; bigPicture: boolean }>();
    for (const suggestion of data?.suggestions ?? []) {
      const entry = map.get(suggestion.parentNodeId) ?? { count: 0, bigPicture: false };
      entry.count += 1;
      if (suggestion.bigPicture) entry.bigPicture = true;
      map.set(suggestion.parentNodeId, entry);
    }
    return map;
  }, [data]);

  const nav = useMemo<SharedCaseNav>(
    () => ({
      contentById,
      openQuestion: selectQuestion,
      hoverQuestion: setHoveredRefId,
    }),
    [contentById, selectQuestion]
  );

  // A shared address is made to be pasted into a chat and opened later, so the
  // tab, the bookmark and the history entry should all say which case it is.
  useDocumentTitle(
    loadState === 'not_found' ? 'Case not found' : data ? data.name || 'Untitled case' : null
  );

  // Send the visitor through login and back to this shared case, so the
  // "Copy & continue" conversion isn't lost across the OAuth round-trip.
  const handleSignIn = () => {
    navigate(`/login?next_url=${encodeURIComponent(window.location.href)}`);
  };

  const handleCopy = async () => {
    if (!graphId || isCopying) return;
    setIsCopying(true);
    try {
      const newGraphId = await copySharedGraph(graphId);
      navigate(`/research/${newGraphId}`);
    } catch {
      alert('Failed to copy the case. Please try again.');
      setIsCopying(false);
    }
  };

  if (loadState === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-parchment font-serif text-sm text-stone-400">
        Loading shared case…
      </div>
    );
  }

  if (loadState === 'not_found' || !data || !tree) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-parchment">
        <div className="font-serif text-xl text-stone-700">Case not found</div>
        <p className="font-serif text-sm text-stone-400">
          It may not exist, or its author stopped sharing it.
        </p>
        <button
          onClick={() => navigate('/')}
          className="mt-2 rounded-full bg-stone-900 px-5 py-2 font-serif text-[13.5px] text-stone-50 transition-colors hover:bg-stone-700"
        >
          Go home
        </button>
      </div>
    );
  }

  const selectedContent = selectedId ? contentById.get(selectedId) : undefined;
  const ancestors = selectedId ? ancestorsOf(tree, selectedId) : [];
  const breadcrumbPath = selectedId ? [...ancestors, selectedId] : [];
  const pendingSuggestions = selectedId
    ? data.suggestions.filter(suggestion => suggestion.parentNodeId === selectedId)
    : [];

  return (
    <div className="flex h-screen flex-col bg-parchment">
      {/* Top bar */}
      <div className="flex h-14 flex-shrink-0 items-center justify-between gap-4 border-b border-stone-200 bg-paper px-5">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate font-serif text-[17px] font-medium text-stone-800">
            {data.name || 'Untitled case'}
          </h1>
          <span className="flex-shrink-0 rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-stone-500">
            Shared · read-only
          </span>
        </div>
        {isAuthenticated ? (
          <button
            onClick={handleCopy}
            disabled={isCopying}
            className="flex flex-shrink-0 items-center gap-2 rounded-full bg-stone-900 py-2 pl-4 pr-5 font-serif text-[13.5px] text-stone-50 shadow-sm transition-colors hover:bg-stone-700 disabled:bg-stone-300"
            data-tooltip="Copy this case into your collection and continue it"
            data-testid="copy-shared-case"
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
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            {isCopying ? 'Copying…' : 'Copy & continue'}
          </button>
        ) : (
          <button
            onClick={handleSignIn}
            className="flex-shrink-0 rounded-full bg-stone-900 px-5 py-2 font-serif text-[13.5px] text-stone-50 shadow-sm transition-colors hover:bg-stone-700"
          >
            Sign in to copy
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left: brief + frontier tree */}
        <div className="flex w-[380px] flex-shrink-0 flex-col border-r border-stone-200 bg-paper">
          {(data.brief || data.caseDocuments.length > 0) && (
            <div className="flex-shrink-0 border-b border-stone-200 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
                Brief
              </div>
              {data.brief && (
                <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap font-serif text-[13px] leading-relaxed text-stone-600">
                  {data.brief}
                </p>
              )}
              {data.caseDocuments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {data.caseDocuments.map(doc => (
                    <span
                      key={doc.id}
                      className="inline-flex max-w-full items-center gap-1 rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[11px] text-stone-500"
                      data-tooltip={doc.name}
                    >
                      <svg
                        className="h-3 w-3 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                        />
                      </svg>
                      <span className="truncate">{doc.name}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="flex-1 overflow-y-auto py-1.5 pl-1 pr-1.5">
            {rows.length === 0 ? (
              <div className="px-4 py-8 text-center font-serif text-xs text-stone-400">
                No questions in this case yet.
              </div>
            ) : (
              rows.map(({ nodeId, depth }) => {
                const kinds = suggestionKinds.get(nodeId);
                return (
                  <SharedFrontierRow
                    key={nodeId}
                    content={contentById.get(nodeId)}
                    depth={depth}
                    isCursor={nodeId === selectedId}
                    isRefHovered={nodeId === hoveredRefId}
                    suggestionCount={kinds?.count ?? 0}
                    hasBigPictureSuggestion={kinds?.bigPicture ?? false}
                    onSelect={() => selectQuestion(nodeId)}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* Right: the thread */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Breadcrumb header, like the research thread's */}
          <div className="flex flex-shrink-0 items-center gap-1 border-b border-stone-200 bg-paper px-3 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              {breadcrumbPath.map((nodeId, index) => (
                <span key={nodeId} className="flex min-w-0 items-center gap-1">
                  {index > 0 && <span className="flex-shrink-0 text-stone-300">›</span>}
                  <button
                    onClick={nodeId === selectedId ? undefined : () => selectQuestion(nodeId)}
                    data-tooltip={contentById.get(nodeId)?.query}
                    className={`max-w-[14rem] truncate font-serif text-xs ${
                      nodeId === selectedId
                        ? 'font-medium text-stone-800'
                        : 'text-stone-400 hover:text-stone-800'
                    }`}
                  >
                    {contentById.get(nodeId)?.query || '(empty question)'}
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-3">
            <div className="mx-auto max-w-3xl">
              {selectedId && selectedContent ? (
                <SharedCaseNavContext.Provider value={nav}>
                  {ancestors.map(ancestorId => {
                    const ancestorContent = contentById.get(ancestorId);
                    if (!ancestorContent) return null;
                    return <SharedAncestorItem key={ancestorId} content={ancestorContent} />;
                  })}

                  {/* The question, quoting the selection it was asked about */}
                  <div className="mb-1 mt-4 flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-stone-900 px-4 py-2.5 font-serif text-[15px] leading-snug text-stone-50">
                      {selectedContent.parentSelectedText && (
                        <div
                          className="mb-1.5 line-clamp-3 border-l-2 border-stone-600 pl-2 text-[12px] italic leading-snug text-stone-400"
                          data-tooltip={selectedContent.parentSelectedText}
                        >
                          {selectedContent.parentSelectedText}
                        </div>
                      )}
                      <div className="whitespace-pre-wrap">{selectedContent.query}</div>
                    </div>
                  </div>

                  {selectedContent.response ? (
                    <>
                      <SharedAnswer content={selectedContent} />
                      {/* Same footer row as the research view, minus the
                          owner's controls; empty:hidden keeps the spacing off
                          answers that were written without a web search. */}
                      <div className="mt-1 flex flex-wrap items-center empty:hidden">
                        <AnswerSources
                          key={selectedId}
                          sources={selectedContent.sources ?? []}
                          found={selectedContent.sourcesFound ?? 0}
                        />
                      </div>
                      <SharedSuggestions suggestions={pendingSuggestions} />
                    </>
                  ) : (
                    <div className="rounded-lg border border-dashed border-stone-300 bg-stone-100/60 p-4 text-center">
                      <div className="font-serif text-xs text-stone-400">
                        This question hasn't been asked yet — copy the case to ask it.
                      </div>
                    </div>
                  )}

                  <div className="h-10" />
                </SharedCaseNavContext.Provider>
              ) : (
                <div className="py-24 text-center font-serif text-sm text-stone-400">
                  {tree.dfsOrder.length === 0
                    ? 'This case has no questions yet.'
                    : 'Select a question from the tree on the left.'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
