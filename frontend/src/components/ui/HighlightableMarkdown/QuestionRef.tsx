/**
 * QuestionRef - the cross-link chip rendered for <questionRef> elements that
 * rehypeQuestionRefs produces from reference tokens in an answer.
 *
 * Stored answers reference questions by node id ([[<uuid>]]), so a chip keeps
 * pointing at the question it cited no matter how the tree is edited later; a
 * chip whose question was deleted renders as an inert "deleted question"
 * tombstone. Outline-number tokens ([[1.2]]) appear only while an answer is
 * streaming and resolve against the live tree — the tree the model is looking
 * at as it writes.
 *
 * The chip shows the target question's lifecycle indicator and text; clicking
 * it navigates via the handler in QuestionRefContext, hovering it highlights
 * the target's row in the frontier. Without a provider (non-research
 * surfaces), or for a streaming token that doesn't resolve, it renders its
 * children — the literal token text — so nothing breaks outside the research
 * view and selection offsets stay exact.
 */

import { createContext, useContext, useEffect, useMemo } from 'react';
import type { FC, ReactNode } from 'react';
import { useGraphStructureStore } from '../../../stores/graphStructureStore';
import { useNodeContentStore } from '../../../stores/nodeContentStore';
import { useResearchStore } from '../../../stores/researchStore';
import { buildQuestionTree } from '../../../utils/questionTree';
import { QuestionStateIcon, useQuestionState, type QuestionState } from '../QuestionStateIcon';

/** Navigation handler for chip clicks; null disables chips (token renders as text). */
export const QuestionRefContext = createContext<((nodeId: string) => void) | null>(null);

export interface QuestionRefProps {
  refNodeId?: string;
  refOutline?: string;
  children?: ReactNode;
}

interface QuestionRefChipProps {
  query: string;
  state: QuestionState;
  /** Length of the source token, so DOM-walk selection offsets stay aligned
   *  where the rendered text differs from the markdown source. */
  sourceLength: number;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/** The chip itself, shared with the shared-case viewer's stand-in resolver. */
export const QuestionRefChip: FC<QuestionRefChipProps> = ({
  query,
  state,
  sourceLength,
  onClick,
  onMouseEnter,
  onMouseLeave,
}) => (
  <button
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
    data-tooltip={query}
    data-source-length={sourceLength}
    className="inline-flex max-w-72 cursor-pointer items-center gap-1 rounded-md border border-stone-300 bg-stone-100 px-1.5 align-bottom font-serif text-[0.85em] leading-snug text-stone-700 transition-colors hover:border-stone-400 hover:bg-stone-200 hover:text-stone-900"
  >
    <span className="text-stone-400">↳</span>
    <span className="flex-shrink-0">
      <QuestionStateIcon state={state} />
    </span>
    <span className="min-w-0 truncate">{query}</span>
  </button>
);

/** Inert chip for a reference whose question no longer exists. */
export const DeletedQuestionRefChip: FC<{ sourceLength: number }> = ({ sourceLength }) => (
  <span
    data-tooltip="This question was deleted"
    data-source-length={sourceLength}
    className="inline-flex max-w-72 items-center gap-1 rounded-md border border-dashed border-stone-300 bg-stone-50 px-1.5 align-bottom font-serif text-[0.85em] italic leading-snug text-stone-400"
  >
    <span className="text-stone-300">↳</span>
    <span className="min-w-0 truncate">deleted question</span>
  </span>
);

export const QuestionRef: FC<QuestionRefProps> = ({ refNodeId, refOutline, children }) => {
  const openQuestion = useContext(QuestionRefContext);
  const nodes = useGraphStructureStore(s => s.nodes);
  const edges = useGraphStructureStore(s => s.edges);
  const setHoveredRefNodeId = useResearchStore(s => s.setHoveredRefNodeId);

  const targetNodeId = useMemo(() => {
    if (!openQuestion) return null;
    if (refNodeId) return refNodeId;
    if (!refOutline) return null;
    const tree = buildQuestionTree(nodes, edges);
    for (const [nodeId, outline] of tree.outlineMap) {
      if (outline === refOutline) return nodeId;
    }
    return null;
  }, [openQuestion, refNodeId, refOutline, nodes, edges]);

  const query = useNodeContentStore(s =>
    targetNodeId ? (s.nodeContents[targetNodeId]?.query ?? '') : ''
  );
  const state = useQuestionState(query ? targetNodeId : null);

  // mouseleave never fires when a hovered chip unmounts (chip click navigates
  // away, answer regenerates) — clear the frontier highlight here instead
  useEffect(() => {
    return () => {
      const store = useResearchStore.getState();
      if (targetNodeId && store.hoveredRefNodeId === targetNodeId) {
        store.setHoveredRefNodeId(null);
      }
    };
  }, [targetNodeId]);

  if (!openQuestion) {
    return <>{children}</>;
  }

  if (!targetNodeId || !query) {
    // An id token names a question that has since been deleted; an outline
    // token that doesn't resolve is a mid-stream artifact — keep it literal.
    return refNodeId ? (
      <DeletedQuestionRefChip sourceLength={`[[${refNodeId}]]`.length} />
    ) : (
      <>{children}</>
    );
  }

  return (
    <QuestionRefChip
      query={query}
      state={state}
      sourceLength={`[[${refNodeId ?? refOutline}]]`.length}
      onClick={() => openQuestion(targetNodeId)}
      onMouseEnter={() => setHoveredRefNodeId(targetNodeId)}
      onMouseLeave={() => setHoveredRefNodeId(null)}
    />
  );
};
