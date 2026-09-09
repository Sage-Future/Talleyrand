import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Edge, GraphData, NodeContent } from '../types';
import { resolveModelId } from '../config/models';
import { useNodeContentStore } from './nodeContentStore';
import { useUIStateStore } from './uiStateStore';
import { useResearchStore } from './researchStore';
import * as autosaveService from '../services/autosaveService';
import { flushAutosave, cancelPendingAutosave } from '../services/autosaveSubscriptions';

export function generateEdgeId(): string {
  return crypto.randomUUID();
}

// A question node. All business data lives in nodeContentStore under the same id;
// the structure store only tracks which nodes exist and how they connect.
export interface GraphNode {
  id: string;
}

interface GraphStructureStore {
  // Core graph state
  id: string;
  name: string | null;
  // Server revision this graph state is built on; echoed on every save so a
  // stale window can never overwrite a newer save (the server answers 409).
  revision: number;

  nodes: GraphNode[];
  edges: Edge[];

  // Pure graph query operations
  getNode: (nodeId: string) => GraphNode | undefined;
  getParentIds: (nodeId: string) => string[];
  getChildIds: (nodeId: string) => string[];

  // Graph mutation operations
  addNode: (node: GraphNode) => void;
  deleteNode: (nodeId: string) => void;
  addEdge: (edge: Edge) => void;

  // Batch operations
  setNodes: (nodes: GraphNode[]) => void;
  setEdges: (edges: Edge[]) => void;
  clearGraph: () => void;

  // ID management
  setId: (value: string) => void;
  setName: (value: string | null) => void;
  setRevision: (value: number) => void;

  deleteNodeWithCleanup: (nodeId: string) => void;

  // Persistence operations
  getGraph: () => GraphData;
  loadGraph: (data: GraphData) => void;
  closeGraph: () => void;
  loadGraphFromBackend: (graphId: string) => Promise<void>;
}

export const useGraphStructureStore = create<GraphStructureStore>()(
  devtools(
    (set, get) => ({
      // Initial state
      id: crypto.randomUUID(),
      name: null,
      revision: 0,

      nodes: [],
      edges: [],

      // Query operations
      getNode: (nodeId: string) => {
        return get().nodes.find(n => n.id === nodeId);
      },

      getParentIds: (nodeId: string) => {
        return get()
          .edges.filter(edge => edge.target === nodeId)
          .map(edge => edge.source);
      },

      getChildIds: (nodeId: string) => {
        return get()
          .edges.filter(edge => edge.source === nodeId)
          .map(edge => edge.target);
      },

      // Mutation operations
      addNode: (node: GraphNode) => {
        set(
          state => ({
            nodes: [...state.nodes, node],
          }),
          false,
          'addNode'
        );
      },

      deleteNode: (nodeId: string) => {
        set(
          state => ({
            nodes: state.nodes.filter(node => node.id !== nodeId),
            edges: state.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId),
          }),
          false,
          'deleteNode'
        );
      },

      addEdge: (edge: Edge) => {
        const { edges } = get();

        // Check if edge already exists
        if (edges.some(e => e.source === edge.source && e.target === edge.target)) {
          return;
        }

        set(
          state => ({
            edges: [...state.edges, edge],
          }),
          false,
          'addEdge'
        );
      },

      // Batch operations
      setNodes: (nodes: GraphNode[]) => {
        set({ nodes }, false, 'setNodes');
      },

      setEdges: (edges: Edge[]) => {
        set({ edges }, false, 'setEdges');
      },

      clearGraph: () => {
        set(
          {
            id: crypto.randomUUID(),
            name: null,
            revision: 0,
            nodes: [],
            edges: [],
          },
          false,
          'clearGraph'
        );
      },

      // ID management
      setId: (value: string) => {
        set({ id: value }, false, 'setId');
      },
      setName: (value: string | null) => {
        set({ name: value }, false, 'setName');
      },
      setRevision: (value: number) => {
        set({ revision: value }, false, 'setRevision');
      },

      deleteNodeWithCleanup: (nodeId: string) => {
        const contentStore = useNodeContentStore.getState();
        const uiStore = useUIStateStore.getState();

        // Check if node was created from a selection - clean up parent's selection reference
        const nodeContent = contentStore.getNodeContent(nodeId);
        if (nodeContent.parentSelectedText) {
          const parentIds = get().getParentIds(nodeId);
          parentIds.forEach(parentId => {
            const parentContent = contentStore.getNodeContent(parentId);
            const updatedSelections = parentContent.selections.filter(
              selection => selection.childNodeId !== nodeId
            );
            contentStore.setNodeContent(parentId, { selections: updatedSelections });
          });
        }

        // Clean up children - clear their parent references so they become independent
        const childIds = get().getChildIds(nodeId);
        childIds.forEach(childId => {
          contentStore.setNodeContent(childId, {
            parentSelectedText: undefined,
          });
        });

        // Clear content and UI state
        contentStore.clearNodeContent(nodeId);
        uiStore.clearNodeUIState(nodeId);

        // Delete from structure
        get().deleteNode(nodeId);
      },

      // Persistence operations
      getGraph: () => {
        const contentStore = useNodeContentStore.getState();
        const researchStore = useResearchStore.getState();

        // Save only essential data from stores. Research answers enter
        // nodeContents only when their generation job completes — streaming
        // text lives in researchStore.streamTexts and is never serialized.
        return {
          // Structure data
          id: get().id,
          name: get().name,
          revision: get().revision,
          nodes: get().nodes,
          edges: get().edges,
          // Content data
          nodeContents: Object.values(contentStore.nodeContents),
          // Research data
          brief: researchStore.brief,
          caseDocuments: researchStore.caseDocuments,
          suggestions: researchStore.suggestions,
          declinedQuestions: researchStore.declinedQuestions,
          readHistory: researchStore.readHistory,
        };
      },

      loadGraph: (data: GraphData) => {
        const contentStore = useNodeContentStore.getState();

        // Flush any pending autosave for the previous graph, then clear state
        flushAutosave();

        get().clearGraph();
        contentStore.clearAllContent();

        // Load structure directly
        get().setId(data.id);
        get().setName(data.name);
        // ?? 0: file exports from before revisions existed load as a new case
        get().setRevision(data.revision ?? 0);
        get().setNodes(data.nodes);
        get().setEdges(data.edges);

        if (data.nodeContents) {
          data.nodeContents.forEach((content: NodeContent) => {
            // An answered question records the model that wrote its answer and
            // keeps it, retired or not. An unanswered one only carries a request,
            // so a retired model there is pointed at its replacement — the model
            // the backend will actually run — instead of misnaming the answer.
            contentStore.setNodeContent(content.id, {
              ...content,
              selectedModel: content.response
                ? content.selectedModel
                : resolveModelId(content.selectedModel),
            });
          });
        }

        // Restore the research slice (defaults normalize legacy file exports)
        useResearchStore.getState().loadPersisted({
          brief: data.brief ?? '',
          caseDocuments: data.caseDocuments ?? [],
          suggestions: data.suggestions ?? [],
          declinedQuestions: data.declinedQuestions ?? [],
          readHistory: data.readHistory ?? [],
        });

        // Cancel autosave triggers from intermediate state changes above
        cancelPendingAutosave();
      },

      /** Drop the open case from the stores without saving it — for a case
       * that no longer exists (deleted here or from another window). The
       * pending autosave must be cancelled, never flushed: flushing would
       * hand the server a case it has already deleted. */
      closeGraph: () => {
        cancelPendingAutosave();
        get().clearGraph();
        useNodeContentStore.getState().clearAllContent();
        const research = useResearchStore.getState();
        research.loadPersisted({
          brief: '',
          caseDocuments: [],
          suggestions: [],
          declinedQuestions: [],
          readHistory: [],
        });
        // No case is open: question addresses are only meaningful against one.
        research.setCaseId(null);
        // The clears above are store writes like any other, each arming the
        // debounce again; drop it once more now that the stores are empty.
        cancelPendingAutosave();
      },

      loadGraphFromBackend: async (graphId: string) => {
        const uiStore = useUIStateStore.getState();

        // Flush any pending autosave for the current graph before loading a new one
        flushAutosave();

        uiStore.setIsLoadingGraph(true);
        // No case is open until this one is in the stores: question addresses
        // are only meaningful against the case they belong to.
        useResearchStore.getState().setCaseId(null);

        try {
          const graphData = await autosaveService.loadGraphById(graphId);
          get().loadGraph(graphData);
          useResearchStore.getState().setCaseId(graphId);
          // Cancel any autosave triggers that fired during loadGraph's intermediate
          // state changes (clearGraph sets nodes/edges to [], which triggers subscriptions).
          // Without this, the debounced autosave could fire after isLoadingGraph is cleared
          // and save an intermediate or empty graph state to the backend.
          cancelPendingAutosave();
        } finally {
          uiStore.setIsLoadingGraph(false);
        }
      },
    }),
    {
      name: 'graph-structure-store',
    }
  )
);
