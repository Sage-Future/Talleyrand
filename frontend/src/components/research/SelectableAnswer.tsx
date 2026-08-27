import { FC, useCallback, useRef } from 'react';
import { useNodeContentStore } from '../../stores/nodeContentStore';
import { useResearchStore } from '../../stores/researchStore';
import { useUIStateStore } from '../../stores/uiStateStore';
import { selectionHandlerService } from '../../services/selectionHandlerService';
import { ResponseDisplay } from '../ui/ResponseDisplay';
import { SelectionPopup } from '../ui/SelectionPopup';
import { QuestionRefContext } from '../ui/HighlightableMarkdown/QuestionRef';
import { InsightContext } from '../ui/HighlightableMarkdown/InsightContext';
import type { TextSelection } from '../../types';

interface SelectableAnswerProps {
  nodeId: string;
}

/**
 * An answer body with the select-to-ask workflow attached. Selecting text
 * opens the popup; submitting moves the cursor to this node and files the
 * follow-up as its child — so selecting in an expanded ancestor is exactly
 * "go to that question, then branch from the selection".
 *
 * Also provides the cross-link navigation handler, so cross-link ref tokens
 * in answers render as clickable question chips.
 */
export const SelectableAnswer: FC<SelectableAnswerProps> = ({ nodeId }) => {
  const wrapperRef = useRef<HTMLDivElement>(null);

  const storedResponse = useNodeContentStore(s => s.nodeContents[nodeId]?.response ?? '');
  const streamText = useResearchStore(s => s.streamTexts[nodeId] ?? '');
  // A completed answer comes from node content; while its job streams, the
  // text lives in the job stream state only.
  const response = storedResponse || streamText;
  const selections = useNodeContentStore(s => s.nodeContents[nodeId]?.selections);
  const highlights = useNodeContentStore(s => s.nodeContents[nodeId]?.highlights);
  const selectionSuggestions = useNodeContentStore(
    s => s.nodeContents[nodeId]?.selectionSuggestions
  );
  const addHighlight = useNodeContentStore(s => s.addHighlight);
  const removeHighlight = useNodeContentStore(s => s.removeHighlight);
  const isStreaming = useResearchStore(s => s.jobs[nodeId]?.status === 'streaming');
  const visitNode = useResearchStore(s => s.visitNode);
  const submitQuestion = useResearchStore(s => s.submitQuestion);
  const askQuestion = useResearchStore(s => s.askQuestion);

  const uiState = useUIStateStore(s => s.nodeUIStates[nodeId] ?? null);
  const setPopupQuery = useUIStateStore(s => s.setPopupQuery);

  const handleSelectionChange = useCallback(
    (selection: TextSelection | null) => {
      useUIStateStore.getState().handleTextSelection(nodeId, selection, wrapperRef.current);
    },
    [nodeId]
  );

  const handlePopupSubmit = useCallback(() => {
    const state = useUIStateStore.getState().getNodeUIState(nodeId);
    if (!state.popupQuery.trim() || !state.selectionInfo) return;
    const selection = state.selectionInfo;
    selectionHandlerService.clearSelection(nodeId);
    // No-op on the cursor; for an ancestor this is the "go there first" step
    visitNode(nodeId);
    submitQuestion(state.popupQuery, selection);
  }, [nodeId, visitNode, submitQuestion]);

  const handlePopupClose = useCallback(() => {
    selectionHandlerService.clearSelection(nodeId);
  }, [nodeId]);

  // The lightbulb: mark the selected passage as an insight, then dismiss the popup.
  const handlePopupHighlight = useCallback(() => {
    const state = useUIStateStore.getState().getNodeUIState(nodeId);
    if (!state.selectionInfo) return;
    addHighlight(nodeId, state.selectionInfo);
    selectionHandlerService.clearSelection(nodeId);
  }, [nodeId, addHighlight]);

  const removeInsight = useCallback(
    (insightId: string) => removeHighlight(nodeId, insightId),
    [nodeId, removeHighlight]
  );

  // Cross-link chip click — same semantics as clicking the row in the frontier:
  // go there, and if the question is still open, ask it.
  const openQuestionRef = useCallback(
    (targetNodeId: string) => {
      visitNode(targetNodeId);
      const isOpen =
        !useResearchStore.getState().jobs[targetNodeId] &&
        !useNodeContentStore.getState().getNodeContent(targetNodeId).response;
      if (isOpen) askQuestion(targetNodeId);
    },
    [visitNode, askQuestion]
  );

  return (
    <div ref={wrapperRef} className="relative font-serif">
      <QuestionRefContext.Provider value={openQuestionRef}>
        <InsightContext.Provider value={removeInsight}>
          <ResponseDisplay
            content={response}
            selections={selections ?? []}
            highlights={highlights ?? []}
            onSelectionChange={handleSelectionChange}
            disableSelection={isStreaming}
            fullHeight={true}
          />
        </InsightContext.Provider>
      </QuestionRefContext.Provider>

      {uiState?.showSelectionPopup && uiState.popupPosition && uiState.selectionInfo && (
        <SelectionPopup
          position={uiState.popupPosition}
          value={uiState.popupQuery || ''}
          onChange={value => setPopupQuery(nodeId, value)}
          onSubmit={handlePopupSubmit}
          onClose={handlePopupClose}
          onHighlight={handlePopupHighlight}
          selection={uiState.selectionInfo}
          suggestions={selectionSuggestions ?? []}
          isLoadingSuggestions={uiState.isLoadingSelectionSuggestions || false}
          onSuggestionSelect={suggestion => setPopupQuery(nodeId, suggestion)}
        />
      )}
    </div>
  );
};
