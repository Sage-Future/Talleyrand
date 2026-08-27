import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { TextSelection, PopupPosition, NodeUIState } from '../types';
import { selectionHandlerService } from '../services/selectionHandlerService';

interface UIStateStore {
  // Global UI state
  showSidebar: boolean;
  showSettingsModal: boolean;
  isLoadingGraph: boolean;

  // Node-specific UI states (indexed by nodeId)
  nodeUIStates: Record<string, NodeUIState>;

  // Global UI operations
  setShowSidebar: (show: boolean) => void;
  setShowSettingsModal: (show: boolean) => void;
  setIsLoadingGraph: (loading: boolean) => void;

  // Node UI operations
  getNodeUIState: (nodeId: string) => NodeUIState;
  setNodeUIState: (nodeId: string, state: Partial<NodeUIState>) => void;
  clearNodeUIState: (nodeId: string) => void;

  // Selection popup operations
  showNodeSelectionPopup: (
    nodeId: string,
    position: PopupPosition,
    selection: TextSelection
  ) => void;
  hideNodeSelectionPopup: (nodeId: string) => void;
  setNodeSuggestionsLoading: (nodeId: string, isLoading: boolean) => void;
  setPopupQuery: (nodeId: string, query: string) => void;
  handleTextSelection: (
    nodeId: string,
    selection: TextSelection | null,
    nodeElement: HTMLElement | null
  ) => void;
}

const defaultNodeUIState: NodeUIState = {
  showSelectionPopup: false,
  selectionInfo: null,
  popupQuery: '',
  isLoadingSelectionSuggestions: false,
};

export const useUIStateStore = create<UIStateStore>()(
  devtools(
    (set, get) => ({
      // Initial state
      showSidebar: true,
      showSettingsModal: false,
      isLoadingGraph: false,
      nodeUIStates: {},

      // Global UI operations
      setShowSidebar: (show: boolean) => {
        set({ showSidebar: show }, false, 'setShowSidebar');
      },

      setShowSettingsModal: (show: boolean) => {
        set({ showSettingsModal: show }, false, 'setShowSettingsModal');
      },

      setIsLoadingGraph: (loading: boolean) => {
        set({ isLoadingGraph: loading }, false, 'setIsLoadingGraph');
      },

      // Node UI operations
      getNodeUIState: (nodeId: string) => {
        const state = get().nodeUIStates[nodeId];
        return { ...defaultNodeUIState, ...state };
      },

      setNodeUIState: (nodeId: string, updates: Partial<NodeUIState>) => {
        set(
          state => {
            const currentState = state.nodeUIStates[nodeId] || { ...defaultNodeUIState };
            return {
              nodeUIStates: {
                ...state.nodeUIStates,
                [nodeId]: { ...currentState, ...updates },
              },
            };
          },
          false,
          'setNodeUIState'
        );
      },

      clearNodeUIState: (nodeId: string) => {
        set(
          state => {
            const { [nodeId]: _, ...rest } = state.nodeUIStates;
            return { nodeUIStates: rest };
          },
          false,
          'clearNodeUIState'
        );
      },

      // Selection popup operations
      showNodeSelectionPopup: (
        nodeId: string,
        position: PopupPosition,
        selection: TextSelection
      ) => {
        get().setNodeUIState(nodeId, {
          showSelectionPopup: true,
          popupPosition: position,
          selectionInfo: selection,
        });
      },

      hideNodeSelectionPopup: (nodeId: string) => {
        get().setNodeUIState(nodeId, {
          showSelectionPopup: false,
          popupPosition: undefined,
          selectionInfo: null,
        });
      },

      setNodeSuggestionsLoading: (nodeId: string, isLoading: boolean) => {
        get().setNodeUIState(nodeId, {
          isLoadingSelectionSuggestions: isLoading,
        });
      },

      setPopupQuery: (nodeId: string, query: string) => {
        get().setNodeUIState(nodeId, {
          popupQuery: query,
        });
      },

      handleTextSelection: (
        nodeId: string,
        selection: TextSelection | null,
        nodeElement: HTMLElement | null
      ) => {
        selectionHandlerService.handleTextSelection(nodeId, selection, nodeElement);
      },
    }),
    {
      name: 'ui-state-store',
    }
  )
);
