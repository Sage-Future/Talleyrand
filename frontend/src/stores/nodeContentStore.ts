import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Document, TextSelection, Highlight, NodeContent, ModelType } from '../types';
import { DEFAULT_MODEL } from '../config/models';

interface NodeContentStore {
  // Node content storage (indexed by nodeId)
  nodeContents: Record<string, NodeContent>;

  // Content operations
  getNodeContent: (nodeId: string) => NodeContent;
  setNodeContent: (nodeId: string, content: Partial<NodeContent>) => void;
  clearNodeContent: (nodeId: string) => void;
  clearAllContent: () => void;

  setNodeResponse: (nodeId: string, response: string) => void;

  // Document operations
  setNodeDocuments: (nodeId: string, documents: Document[]) => void;

  // Suggestion operations
  setSelectionSuggestions: (nodeId: string, suggestions: string[]) => void;

  // Selection operations
  addNodeSelection: (nodeId: string, selection: TextSelection) => void;

  // Highlight (insight) operations
  addHighlight: (nodeId: string, selection: TextSelection) => void;
  removeHighlight: (nodeId: string, highlightId: string) => void;

  // Model operations
  setNodeModel: (nodeId: string, model: ModelType) => void;
}

const createDefaultNodeContent = (nodeId: string): NodeContent => {
  return {
    id: nodeId,
    query: '',
    response: '',
    selectedModel: DEFAULT_MODEL,
    documents: [],
    selectionSuggestions: [],
    selections: [],
    highlights: [],
    sources: [],
    sourcesFound: 0,
  };
};

export const useNodeContentStore = create<NodeContentStore>()(
  devtools(
    (set, get) => ({
      // Initial state
      nodeContents: {},

      // Content operations
      getNodeContent: (nodeId: string) => {
        const content = get().nodeContents[nodeId];
        return content || createDefaultNodeContent(nodeId);
      },

      setNodeContent: (nodeId: string, updates: Partial<NodeContent>) => {
        set(
          state => {
            const currentContent = state.nodeContents[nodeId] || createDefaultNodeContent(nodeId);
            return {
              nodeContents: {
                ...state.nodeContents,
                [nodeId]: { ...currentContent, ...updates },
              },
            };
          },
          false,
          'setNodeContent'
        );
      },

      clearNodeContent: (nodeId: string) => {
        set(
          state => {
            const { [nodeId]: _, ...rest } = state.nodeContents;
            return { nodeContents: rest };
          },
          false,
          'clearNodeContent'
        );
      },

      clearAllContent: () => {
        set({ nodeContents: {} }, false, 'clearAllContent');
      },

      setNodeResponse: (nodeId: string, response: string) => {
        get().setNodeContent(nodeId, { response });
      },

      // Document operations
      setNodeDocuments: (nodeId: string, documents: Document[]) => {
        get().setNodeContent(nodeId, { documents });
      },

      // Suggestion operations
      setSelectionSuggestions: (nodeId: string, suggestions: string[]) => {
        get().setNodeContent(nodeId, { selectionSuggestions: suggestions });
      },

      // Selection operations
      addNodeSelection: (nodeId: string, selection: TextSelection) => {
        const currentContent = get().getNodeContent(nodeId);
        get().setNodeContent(nodeId, {
          selections: [...currentContent.selections, selection],
        });
      },

      // Highlight (insight) operations
      addHighlight: (nodeId: string, selection: TextSelection) => {
        if (selection.startOffset === undefined || selection.endOffset === undefined) return;
        const currentContent = get().getNodeContent(nodeId);
        // Re-marking the exact same passage is a no-op (the lightbulb is add-only;
        // removal is the × on the highlight itself).
        const duplicate = currentContent.highlights.some(
          h => h.startOffset === selection.startOffset && h.endOffset === selection.endOffset
        );
        if (duplicate) return;

        const highlight: Highlight = {
          id: crypto.randomUUID(),
          text: selection.text,
          startOffset: selection.startOffset,
          endOffset: selection.endOffset,
          prefix: selection.prefix,
          suffix: selection.suffix,
          createdAt: new Date().toISOString(),
        };
        get().setNodeContent(nodeId, {
          highlights: [...currentContent.highlights, highlight],
        });
      },

      removeHighlight: (nodeId: string, highlightId: string) => {
        const currentContent = get().getNodeContent(nodeId);
        get().setNodeContent(nodeId, {
          highlights: currentContent.highlights.filter(h => h.id !== highlightId),
        });
      },

      // Model operations
      setNodeModel: (nodeId: string, model: ModelType) => {
        get().setNodeContent(nodeId, { selectedModel: model });
      },
    }),
    {
      name: 'node-content-store',
    }
  )
);
