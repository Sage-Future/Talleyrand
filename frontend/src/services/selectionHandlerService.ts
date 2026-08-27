import type { TextSelection, PopupPosition } from '../types';
import { useNodeContentStore } from '../stores/nodeContentStore';
import { useUIStateStore } from '../stores/uiStateStore';
import { useGraphStructureStore } from '../stores/graphStructureStore';
import { questionSuggestionService } from './questionSuggestionService';

class SelectionHandlerService {
  // Store abort controllers for selection suggestion requests
  private abortControllers = new Map<string, AbortController>();

  /**
   * Handles text selection in a node's response.
   * Calculates popup position, shows the popup, and generates suggestions.
   * Cancels any previous suggestion request for the same node.
   */
  handleTextSelection(
    nodeId: string,
    selection: TextSelection | null,
    nodeElement: HTMLElement | null
  ): void {
    const contentStore = useNodeContentStore.getState();
    const uiStore = useUIStateStore.getState();

    // Cancel any previous selection suggestion request for this node
    this.cancelSuggestionRequest(nodeId);

    if (!selection) {
      this.clearSelection(nodeId);
      return;
    }

    // Calculate popup position
    const popupPosition = this.calculatePopupPosition(selection, nodeElement);

    // Show popup immediately
    uiStore.showNodeSelectionPopup(nodeId, popupPosition, selection);
    uiStore.setNodeSuggestionsLoading(nodeId, true);
    uiStore.setPopupQuery(nodeId, '');

    // Generate suggestions async
    this.generateSuggestions(nodeId, selection);
  }

  /**
   * Clears selection state for a node.
   */
  clearSelection(nodeId: string): void {
    const contentStore = useNodeContentStore.getState();
    const uiStore = useUIStateStore.getState();

    this.cancelSuggestionRequest(nodeId);
    uiStore.hideNodeSelectionPopup(nodeId);
    uiStore.setPopupQuery(nodeId, '');
    contentStore.setSelectionSuggestions(nodeId, []);
  }

  /**
   * Calculates the popup position relative to the node element.
   * getBoundingClientRect() returns viewport coordinates and already accounts
   * for scrolling, so the difference of the two rects is the local position.
   */
  private calculatePopupPosition(
    selection: TextSelection,
    nodeElement: HTMLElement | null
  ): PopupPosition {
    if (selection.rect && nodeElement) {
      const nodeRect = nodeElement.getBoundingClientRect();
      return {
        x: (selection.rect.left + selection.rect.right) / 2 - nodeRect.left,
        y: selection.rect.bottom - nodeRect.top + 10,
      };
    }
    return { x: 0, y: 0 };
  }

  /**
   * Generates suggestions for the selected text.
   * Uses AbortController to allow cancellation.
   */
  private async generateSuggestions(nodeId: string, selection: TextSelection): Promise<void> {
    const contentStore = useNodeContentStore.getState();
    const uiStore = useUIStateStore.getState();

    // Create new abort controller for this request
    const abortController = new AbortController();
    this.abortControllers.set(nodeId, abortController);

    try {
      const result = await questionSuggestionService.generateSuggestions(
        useGraphStructureStore.getState().getGraph(),
        nodeId,
        selection.text,
        selection.prefix,
        selection.suffix,
        abortController.signal
      );

      // Only update if not aborted
      if (!abortController.signal.aborted) {
        contentStore.setSelectionSuggestions(nodeId, result.questions);
        uiStore.setNodeSuggestionsLoading(nodeId, false);
        this.abortControllers.delete(nodeId);
      }
    } catch (error: any) {
      // Ignore abort errors
      if (error.name === 'AbortError') {
        return;
      }

      console.error('Failed to generate selection suggestions:', error);

      if (!abortController.signal.aborted) {
        contentStore.setSelectionSuggestions(nodeId, []);
        uiStore.setNodeSuggestionsLoading(nodeId, false);
        this.abortControllers.delete(nodeId);
      }
    }
  }

  /**
   * Cancels any pending suggestion request for a node.
   */
  private cancelSuggestionRequest(nodeId: string): void {
    const controller = this.abortControllers.get(nodeId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(nodeId);
    }
  }
}

export const selectionHandlerService = new SelectionHandlerService();
