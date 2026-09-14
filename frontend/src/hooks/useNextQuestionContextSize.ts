import { useEffect, useRef, useState } from 'react';
import type { ModelType } from '../config/models';
import { countNextQuestionContext, type ContextSize } from '../services/contextSizeService';
import { useGraphStructureStore } from '../stores/graphStructureStore';
import { useUIStateStore } from '../stores/uiStateStore';
import type { Document } from '../types';

// Coalesces the burst of store updates one action produces into a single count.
const RECOUNT_DELAY_MS = 400;

/**
 * The size of the prompt the next question would send, counted on the backend
 * by the tokenizer that will judge it.
 *
 * The backend counts the saved case, so the count is refreshed whenever a
 * save lands (the revision changes) and whenever something outside the saved
 * case changes the count: the model that would answer (a different tokenizer)
 * and the documents staged on the draft. The question the draft would be
 * filed under moves the draft's line in the prompt by a few tokens, so a
 * cursor move sends no new count — counting a large case means uploading it —
 * but the next count uses the current parent. Undefined until the first count
 * of the open case arrives, and while the case has never been saved.
 */
export function useNextQuestionContextSize(input: {
  model: ModelType;
  parentNodeId: string | null;
  draftDocuments: Document[];
}): ContextSize | undefined {
  const { model, parentNodeId, draftDocuments } = input;
  const graphId = useGraphStructureStore(s => s.id);
  const saved = useGraphStructureStore(s => s.name !== null);
  const revision = useGraphStructureStore(s => s.revision);
  const isLoadingGraph = useUIStateStore(s => s.isLoadingGraph);
  const [counted, setCounted] = useState<{ graphId: string; size: ContextSize }>();
  const parentNodeIdRef = useRef(parentNodeId);
  parentNodeIdRef.current = parentNodeId;

  useEffect(() => {
    if (!saved || isLoadingGraph) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const size = await countNextQuestionContext(
        { graphId, model, parentNodeId: parentNodeIdRef.current, draftDocuments },
        controller.signal
      );
      if (size && !controller.signal.aborted) setCounted({ graphId, size });
    }, RECOUNT_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [graphId, saved, revision, isLoadingGraph, model, draftDocuments]);

  return counted?.graphId === graphId ? counted.size : undefined;
}
