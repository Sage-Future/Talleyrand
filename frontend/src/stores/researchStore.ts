import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  DeclinedQuestion,
  DeclineReason,
  Document,
  ModelType,
  ReadEvent,
  ResearchSuggestion,
  TextSelection,
} from '../types';
import { resolveModelId } from '../config/models';
import { isParentSummaryEnabled } from '../client';
import { useGraphStructureStore, generateEdgeId, type GraphNode } from './graphStructureStore';
import { useNodeContentStore } from './nodeContentStore';
import { buildQuestionTree, ancestorsOf, descendantsOf } from '../utils/questionTree';
import { researchGenerationService } from '../services/researchGenerationService';
import { researchSuggestionService } from '../services/researchSuggestionService';
import {
  historyBack,
  historyForward,
  pushNewQuestion,
  pushQuestion,
  replaceNewQuestion,
  replaceQuestion,
} from '../routes/caseNavigation';

// Every Nth first-read additionally triggers the big-picture suggester
const BIG_PICTURE_READ_INTERVAL = 5;

// Normalized key for near-duplicate question detection (the server applies the
// same rule when assembling suggestion batches)
function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

type ResearchJobState =
  | { status: 'queued' }
  | { status: 'streaming' }
  | { status: 'error'; message: string };

export interface ResearchPersistedState {
  brief: string;
  caseDocuments: Document[];
  suggestions: ResearchSuggestion[];
  declinedQuestions: DeclinedQuestion[];
  readHistory: ReadEvent[];
}

interface ResearchStore extends ResearchPersistedState {
  // Runtime state
  // Model applied to every newly created question (persisted in localStorage)
  defaultModel: ModelType;
  setDefaultModel: (model: ModelType) => void;
  // "Summarize parents" (persisted in localStorage): the thread above a
  // question is shown as one cheat sheet instead of a stack of collapsed
  // ancestors, and every new answer generates one.
  summarizeParents: boolean;
  setSummarizeParents: (enabled: boolean) => void;
  cursorNodeId: string | null;
  // The open case. Its id is half of every question address, so cursor moves
  // can only happen while a case is open.
  caseId: string | null;
  setCaseId: (caseId: string | null) => void;
  // Bumped every time a case's contents land in the stores, so the case view
  // knows to read the address against the questions that are now loaded.
  caseRevision: number;
  // Where the case was left off, for an address that names no question.
  resumeQuestionId: () => string | null;
  // Questions landed on in this case, oldest first, each listed once.
  visitedTrail: string[];
  // Where the browser history sits inside the case: the depth of the entry the
  // user is on, and the deepest entry still reachable forward.
  historyDepth: number;
  historyTop: number;
  setHistoryPosition: (depth: number, isPush: boolean) => void;
  // True while composing a brand-new root question: the thread shows an empty
  // chat and the next submit creates a root question, not a follow-up.
  composingRoot: boolean;
  // Question targeted by a hovered cross-link chip; the frontier highlights its row
  hoveredRefNodeId: string | null;
  setHoveredRefNodeId: (nodeId: string | null) => void;
  jobs: Record<string, ResearchJobState>;
  // Questions whose parent cheat sheet is being generated right now (the sheet
  // itself lands in nodeContents). Written by researchGenerationService only.
  cheatSheetPending: Record<string, true>;
  setCheatSheetPending: (nodeId: string, pending: boolean) => void;
  // Streamed answer text of nodes with active jobs, keyed by node id. Kept
  // out of `jobs` so per-chunk updates re-render only the answer view, and
  // out of nodeContents so partials are never persisted.
  streamTexts: Record<string, string>;
  // A question pulled back into the composer by an Esc-abort (its in-flight
  // first answer was cancelled): ThreadInput loads it, then clears this. A
  // select-to-ask question keeps its quote so the composer can re-attach it;
  // selectionSourceNodeId is the parent answer those offsets index into.
  restoredDraft: {
    text: string;
    documents: Document[];
    selection: TextSelection | null;
    selectionSourceNodeId: string | null;
  } | null;
  clearRestoredDraft: () => void;

  // Persistence composition (called from graphStructureStore.loadGraph)
  loadPersisted: (data: ResearchPersistedState) => void;

  // Brief / case documents
  setBrief: (brief: string) => void;
  setCaseDocuments: (documents: Document[]) => void;

  // Kickstart modal confirm: brief + documents land on the case,
  // approved questions become root nodes and prefetch, declined become anti-targets
  applyKickstart: (payload: {
    brief: string;
    documents: Document[];
    approvedQuestions: string[];
    declinedQuestions: { text: string; reason: DeclineReason | null }[];
  }) => void;

  // Job state (written by researchGenerationService only)
  setJob: (nodeId: string, job: ResearchJobState | null) => void;
  setStreamText: (nodeId: string, text: string) => void;
  appendStreamText: (nodeId: string, delta: string) => void;
  clearStreamText: (nodeId: string) => void;

  // Cursor & navigation. Every move is a browser history entry, so the app's
  // own back/forward and the browser's walk the same trail.
  visitNode: (nodeId: string) => void;
  goBack: () => void;
  goForward: () => void;
  // Open an empty chat for a new root-level question (created on submit)
  startNewRootQuestion: () => void;
  // Move the cursor without recording a history step. Called by the case view
  // when the address moves the user (Back/Forward, a reload, a link opened
  // cold), and by visitNode, which records the step itself.
  applyCursor: (nodeId: string | null, composingRoot: boolean) => void;

  // Reading (single first-read choke point)
  isRead: (nodeId: string) => boolean;
  markRead: (nodeId: string) => void;
  onAnswerCompleted: (nodeId: string) => void;

  // Question lifecycle
  createResearchChildNode: (
    parentId: string | null,
    query: string,
    selection?: TextSelection
  ) => string;
  submitQuestion: (query: string, selection?: TextSelection, documents?: Document[]) => void;
  askQuestion: (nodeId: string) => void;
  toggleResolved: (nodeId: string) => void;
  toggleLoved: (nodeId: string) => void;
  deleteQuestion: (nodeId: string) => void;
  // Cancel an in-flight first answer, remove its question, and return the
  // question's text/documents to the composer (Esc-abort).
  abortQuestion: (nodeId: string) => void;

  // Suggestions (full objects assembled server-side: ids, placement). They live
  // under their parent question in the thread until the user accepts or declines
  // them — no lifespan. A batch's job record is acked only once the batch is
  // incorporated (durable-jobs invariant), so a batch lost before that simply
  // replays on the next connect.
  addSuggestions: (jobId: string, suggestions: ResearchSuggestion[]) => void;
  insertSuggestions: (suggestions: ResearchSuggestion[]) => void;
  acceptSuggestion: (suggestionId: string) => void;
  declineSuggestion: (suggestionId: string, reason: DeclineReason | null) => void;
  requestMoreSuggestions: (nodeId: string) => void;

  // Suggestion generations in flight, jobId -> parent node id (null = big-picture).
  // Runtime-only; drives the "generating…" indicators and is cleared when the
  // batch (or its error) lands on the job stream.
  suggestionJobs: Record<string, string | null>;
  addSuggestionJob: (jobId: string, nodeId: string | null) => void;
  removeSuggestionJob: (jobId: string) => void;
}

const emptyPersistedState: ResearchPersistedState = {
  brief: '',
  caseDocuments: [],
  suggestions: [],
  declinedQuestions: [],
  readHistory: [],
};

function initialDefaultModel(): ModelType {
  return resolveModelId(localStorage.getItem('default_model'));
}

export const useResearchStore = create<ResearchStore>()(
  devtools(
    (set, get) => ({
      ...emptyPersistedState,

      defaultModel: initialDefaultModel(),

      setDefaultModel: (model: ModelType) => {
        localStorage.setItem('default_model', model);
        set({ defaultModel: model }, false, 'setDefaultModel');
      },

      summarizeParents: isParentSummaryEnabled(),

      setSummarizeParents: (enabled: boolean) => {
        localStorage.setItem('summarize_parents', enabled.toString());
        set({ summarizeParents: enabled }, false, 'setSummarizeParents');
      },

      cursorNodeId: null,
      caseId: null,
      caseRevision: 0,
      visitedTrail: [],
      historyDepth: 0,
      historyTop: 0,
      composingRoot: false,
      hoveredRefNodeId: null,
      jobs: {},
      streamTexts: {},
      cheatSheetPending: {},
      restoredDraft: null,
      suggestionJobs: {},

      setHoveredRefNodeId: (nodeId: string | null) => {
        set({ hoveredRefNodeId: nodeId }, false, 'setHoveredRefNodeId');
      },

      setCaseId: (caseId: string | null) => {
        set({ caseId }, false, 'setCaseId');
      },

      setHistoryPosition: (depth: number, isPush: boolean) => {
        // A push drops whatever was ahead, so the forward end comes back to here.
        set(
          state => ({
            historyDepth: depth,
            historyTop: isPush ? depth : Math.max(state.historyTop, depth),
          }),
          false,
          'setHistoryPosition'
        );
      },

      resumeQuestionId: () => {
        // Where the case was left off: the most recent question read that is
        // still in the tree, and failing that its first question.
        const structure = useGraphStructureStore.getState();
        const tree = buildQuestionTree(structure.nodes, structure.edges);
        const lastRead = [...get().readHistory]
          .reverse()
          .find(event => tree.outlineMap.has(event.nodeId));
        return lastRead?.nodeId ?? tree.rootIds[0] ?? null;
      },

      loadPersisted: (data: ResearchPersistedState) => {
        // No cursor: which question is open is the address's call, and the case
        // view re-reads it against this freshly loaded case.
        set(
          state => ({
            ...data,
            caseRevision: state.caseRevision + 1,
            cursorNodeId: null,
            visitedTrail: [],
            composingRoot: false,
            jobs: {},
            streamTexts: {},
            cheatSheetPending: {},
            restoredDraft: null,
            suggestionJobs: {},
          }),
          false,
          'loadPersisted'
        );
      },

      setBrief: (brief: string) => {
        set({ brief }, false, 'setBrief');
      },

      setCaseDocuments: (documents: Document[]) => {
        set({ caseDocuments: documents }, false, 'setCaseDocuments');
      },

      applyKickstart: payload => {
        const now = new Date().toISOString();
        set(
          state => ({
            brief: payload.brief,
            caseDocuments: payload.documents,
            declinedQuestions: [
              ...state.declinedQuestions,
              ...payload.declinedQuestions.map(({ text, reason }) => ({
                text,
                reason,
                parentNodeId: null,
                declinedAt: now,
              })),
            ],
          }),
          false,
          'applyKickstart'
        );

        const createdIds = payload.approvedQuestions.map(text =>
          get().createResearchChildNode(null, text)
        );
        createdIds.forEach(nodeId => researchGenerationService.ask(nodeId, { background: true }));
        if (createdIds.length > 0) {
          get().visitNode(createdIds[0]);
        }
      },

      setJob: (nodeId: string, job: ResearchJobState | null) => {
        set(
          state => {
            if (job === null) {
              if (!(nodeId in state.jobs)) return state;
              const { [nodeId]: _, ...rest } = state.jobs;
              return { jobs: rest };
            }
            return { jobs: { ...state.jobs, [nodeId]: job } };
          },
          false,
          'setJob'
        );
      },

      setCheatSheetPending: (nodeId: string, pending: boolean) => {
        set(
          state => {
            if (pending)
              return { cheatSheetPending: { ...state.cheatSheetPending, [nodeId]: true } };
            if (!(nodeId in state.cheatSheetPending)) return state;
            const { [nodeId]: _, ...rest } = state.cheatSheetPending;
            return { cheatSheetPending: rest };
          },
          false,
          'setCheatSheetPending'
        );
      },

      setStreamText: (nodeId: string, text: string) => {
        set(
          state => ({ streamTexts: { ...state.streamTexts, [nodeId]: text } }),
          false,
          'setStreamText'
        );
      },

      appendStreamText: (nodeId: string, delta: string) => {
        set(
          state => ({
            streamTexts: {
              ...state.streamTexts,
              [nodeId]: (state.streamTexts[nodeId] ?? '') + delta,
            },
          }),
          false,
          'appendStreamText'
        );
      },

      clearStreamText: (nodeId: string) => {
        set(
          state => {
            if (!(nodeId in state.streamTexts)) return state;
            const { [nodeId]: _, ...rest } = state.streamTexts;
            return { streamTexts: rest };
          },
          false,
          'clearStreamText'
        );
      },

      visitNode: (nodeId: string) => {
        const { cursorNodeId, composingRoot, caseId } = get();
        if (nodeId === cursorNodeId && !composingRoot) return;
        if (!caseId) return;

        get().applyCursor(nodeId, false);
        pushQuestion(caseId, nodeId);
      },

      startNewRootQuestion: () => {
        // Empty chat with no row selected; the next submitQuestion turns the
        // entry into a root question, just like a kickstart question.
        // Asking for the empty chat while already on it would stack a second
        // identical history entry, and stepping back off it would do nothing.
        const { caseId, composingRoot } = get();
        if (!caseId || composingRoot) return;
        set({ composingRoot: true, cursorNodeId: null }, false, 'startNewRootQuestion');
        pushNewQuestion(caseId);
      },

      applyCursor: (nodeId: string | null, composingRoot: boolean) => {
        if (get().cursorNodeId === nodeId && get().composingRoot === composingRoot) return;

        set(
          state => ({
            cursorNodeId: nodeId,
            composingRoot,
            visitedTrail:
              nodeId !== null
                ? [...state.visitedTrail.filter(id => id !== nodeId), nodeId]
                : state.visitedTrail,
          }),
          false,
          'applyCursor'
        );

        if (nodeId !== null) get().markRead(nodeId);
      },

      goBack: () => {
        if (get().historyDepth === 0) return;
        historyBack();
      },

      goForward: () => {
        const { historyDepth, historyTop } = get();
        if (historyDepth >= historyTop) return;
        historyForward();
      },

      isRead: (nodeId: string) => {
        return get().readHistory.some(event => event.nodeId === nodeId);
      },

      markRead: (nodeId: string) => {
        // First-read choke point. Only completed answers count: a node with an
        // active job is still generating, an empty response is still open.
        if (get().isRead(nodeId)) return;
        if (get().jobs[nodeId]) return;
        const content = useNodeContentStore.getState().getNodeContent(nodeId);
        if (!content.response) return;

        set(
          state => ({
            readHistory: [...state.readHistory, { nodeId, at: new Date().toISOString() }],
          }),
          false,
          'markRead'
        );

        researchSuggestionService.fetchSuggestions(nodeId, false);
        if (get().readHistory.length % BIG_PICTURE_READ_INTERVAL === 0) {
          researchSuggestionService.fetchBigPictureSuggestions();
        }
      },

      onAnswerCompleted: (nodeId: string) => {
        // The user watched the answer finish — that counts as reading it
        if (get().cursorNodeId === nodeId) {
          get().markRead(nodeId);
        }
      },

      createResearchChildNode: (
        parentId: string | null,
        query: string,
        selection?: TextSelection
      ) => {
        const structure = useGraphStructureStore.getState();
        const contentStore = useNodeContentStore.getState();

        const newNodeId = crypto.randomUUID();

        const newNode: GraphNode = { id: newNodeId };
        structure.addNode(newNode);

        contentStore.setNodeContent(newNodeId, {
          id: newNodeId,
          query,
          response: '',
          selectedModel: get().defaultModel,
          parentSelectedText: selection?.text,
          parentSelectedPrefix: selection?.prefix,
          parentSelectedSuffix: selection?.suffix,
        });

        if (parentId) {
          structure.addEdge({
            id: generateEdgeId(),
            source: parentId,
            target: newNodeId,
          });

          // Persist quote anchors on the parent so the selection stays highlighted.
          // rect is live popup geometry, not part of the persisted anchor.
          if (
            selection &&
            selection.startOffset !== undefined &&
            selection.endOffset !== undefined
          ) {
            const { rect: _rect, ...anchor } = selection;
            contentStore.addNodeSelection(parentId, { ...anchor, childNodeId: newNodeId });
          }
        }

        return newNodeId;
      },

      submitQuestion: (query: string, selection?: TextSelection, documents?: Document[]) => {
        const trimmed = query.trim();
        if (!trimmed) return;

        const structure = useGraphStructureStore.getState();
        const tree = buildQuestionTree(structure.nodes, structure.edges);
        // A fresh root when composing one (or when the tree is empty); a
        // follow-up under the cursor otherwise.
        const composingRoot = get().composingRoot;
        const parentId = composingRoot || tree.dfsOrder.length === 0 ? null : get().cursorNodeId;
        if (parentId === null && !composingRoot && tree.dfsOrder.length > 0) return;

        const newNodeId = get().createResearchChildNode(parentId, trimmed, selection);
        if (documents && documents.length > 0) {
          useNodeContentStore.getState().setNodeDocuments(newNodeId, documents);
        }
        get().visitNode(newNodeId); // clears composingRoot
        researchGenerationService.ask(newNodeId, { background: false });
      },

      abortQuestion: (nodeId: string) => {
        const job = get().jobs[nodeId];
        // Only a first answer still in flight can be pulled back to the composer.
        // A regeneration leaves the node read, and the node may have children —
        // deleting it would take the whole subtree with it.
        if (!job || (job.status !== 'streaming' && job.status !== 'queued')) return;
        if (get().isRead(nodeId)) return;

        const structure = useGraphStructureStore.getState();
        const tree = buildQuestionTree(structure.nodes, structure.edges);
        if ((tree.childrenMap.get(nodeId)?.length ?? 0) > 0) return; // never orphan a subtree
        const parentId = tree.parentMap.get(nodeId) ?? null;

        const contentStore = useNodeContentStore.getState();
        const content = contentStore.getNodeContent(nodeId);
        // A select-to-ask question's quote anchor lives on the parent, keyed by
        // this child. Capture it before deleteQuestion prunes it, so the draft
        // keeps its tie to the selected passage and can re-attach on resubmit.
        const selection =
          parentId !== null
            ? (contentStore
                .getNodeContent(parentId)
                .selections.find(s => s.childNodeId === nodeId) ?? null)
            : null;
        const draft = {
          text: content.query,
          documents: content.documents ?? [],
          selection,
          selectionSourceNodeId: selection ? parentId : null,
        };

        // Re-open the composer where the question was: a follow-up returns to its
        // (read) parent, a root question to the new-root composing state. Moving
        // the cursor off the question first leaves the deletion below with
        // nothing to redirect, so the address is rewritten exactly once.
        if (parentId === null) {
          set({ composingRoot: true, cursorNodeId: null }, false, 'abortQuestion');
          const caseId = get().caseId;
          if (caseId) replaceNewQuestion(caseId);
        }

        // Remove the question (and discard its local job); the prompt save in
        // cancelAbortedGeneration prunes the server record and cancels the run.
        get().deleteQuestion(nodeId);
        set({ restoredDraft: draft }, false, 'abortQuestion/restore');

        researchGenerationService.cancelAbortedGeneration();
      },

      clearRestoredDraft: () => {
        set({ restoredDraft: null }, false, 'clearRestoredDraft');
      },

      askQuestion: (nodeId: string) => {
        researchGenerationService.ask(nodeId, { background: false });
      },

      toggleResolved: (nodeId: string) => {
        const contentStore = useNodeContentStore.getState();
        const content = contentStore.getNodeContent(nodeId);
        contentStore.setNodeContent(nodeId, {
          resolvedAt: content.resolvedAt ? null : new Date().toISOString(),
        });
      },

      toggleLoved: (nodeId: string) => {
        const contentStore = useNodeContentStore.getState();
        const content = contentStore.getNodeContent(nodeId);
        contentStore.setNodeContent(nodeId, {
          lovedAt: content.lovedAt ? null : new Date().toISOString(),
        });
      },

      deleteQuestion: (nodeId: string) => {
        const structure = useGraphStructureStore.getState();
        const tree = buildQuestionTree(structure.nodes, structure.edges);
        const deletedIds = [nodeId, ...descendantsOf(tree, nodeId)];
        const deletedSet = new Set(deletedIds);

        // Local job state only: the save that persists this deletion prunes
        // the server-side records and cancels their running tasks.
        researchGenerationService.discardLocalJobs(deletedIds);

        // Delete deepest-first so child cleanup never touches already-deleted parents
        [...deletedIds].reverse().forEach(id => structure.deleteNodeWithCleanup(id));

        const parentOfDeleted = tree.parentMap.get(nodeId) ?? null;
        // A question that is going away can't stay in the address. Point the
        // current history entry at its parent instead of adding a step, so Back
        // still leads where the user came from.
        const caseId = get().caseId;
        if (caseId && deletedSet.has(get().cursorNodeId ?? '')) {
          replaceQuestion(caseId, parentOfDeleted);
        }
        set(
          state => ({
            suggestions: state.suggestions.filter(s => !deletedSet.has(s.parentNodeId)),
            suggestionJobs: Object.fromEntries(
              Object.entries(state.suggestionJobs).filter(
                ([, nid]) => nid === null || !deletedSet.has(nid)
              )
            ),
            readHistory: state.readHistory.filter(event => !deletedSet.has(event.nodeId)),
            visitedTrail: state.visitedTrail.filter(id => !deletedSet.has(id)),
            cursorNodeId: deletedSet.has(state.cursorNodeId ?? '')
              ? parentOfDeleted
              : state.cursorNodeId,
          }),
          false,
          'deleteQuestion'
        );
      },

      addSuggestions: (jobId: string, suggestions: ResearchSuggestion[]) => {
        get().insertSuggestions(suggestions);
        // Ack only now that the suggestions are in persisted state: the next
        // save carries both the suggestions and the ack, retiring the record.
        researchGenerationService.ackJob(jobId);
      },

      insertSuggestions: (suggestions: ResearchSuggestion[]) => {
        // The server dedups a batch against the saved graph; this re-applies
        // the same rule against live local state (questions typed since, a
        // concurrently arrived batch) and drops orphans of deleted nodes.
        const structure = useGraphStructureStore.getState();
        const taken = new Set<string>();
        Object.values(useNodeContentStore.getState().nodeContents).forEach(content => {
          if (content.query) taken.add(normalizeQuestion(content.query));
        });
        const state = get();
        state.suggestions.forEach(s => taken.add(normalizeQuestion(s.text)));
        state.declinedQuestions.forEach(d => taken.add(normalizeQuestion(d.text)));
        const existingIds = new Set(state.suggestions.map(s => s.id));

        const fresh = suggestions.filter(suggestion => {
          if (existingIds.has(suggestion.id)) return false;
          if (!structure.getNode(suggestion.parentNodeId)) return false;
          const key = normalizeQuestion(suggestion.text);
          if (!key || taken.has(key)) return false;
          taken.add(key);
          return true;
        });

        if (fresh.length === 0) return;
        set(s => ({ suggestions: [...s.suggestions, ...fresh] }), false, 'insertSuggestions');
      },

      acceptSuggestion: (suggestionId: string) => {
        const suggestion = get().suggestions.find(s => s.id === suggestionId);
        if (!suggestion) return;

        set(
          state => ({ suggestions: state.suggestions.filter(s => s.id !== suggestionId) }),
          false,
          'acceptSuggestion'
        );

        // Curation, not navigation: file the question and prefetch, keep the cursor
        const newNodeId = get().createResearchChildNode(suggestion.parentNodeId, suggestion.text);
        researchGenerationService.ask(newNodeId, { background: true });
      },

      declineSuggestion: (suggestionId: string, reason: DeclineReason | null) => {
        const suggestion = get().suggestions.find(s => s.id === suggestionId);
        if (!suggestion) return;
        set(
          state => ({
            suggestions: state.suggestions.filter(s => s.id !== suggestionId),
            declinedQuestions: [
              ...state.declinedQuestions,
              {
                text: suggestion.text,
                reason,
                parentNodeId: suggestion.parentNodeId,
                declinedAt: new Date().toISOString(),
              },
            ],
          }),
          false,
          'declineSuggestion'
        );
      },

      requestMoreSuggestions: (nodeId: string) => {
        researchSuggestionService.fetchSuggestions(nodeId, true);
      },

      addSuggestionJob: (jobId: string, nodeId: string | null) => {
        set(
          state => ({ suggestionJobs: { ...state.suggestionJobs, [jobId]: nodeId } }),
          false,
          'addSuggestionJob'
        );
      },

      removeSuggestionJob: (jobId: string) => {
        set(
          state => {
            if (!(jobId in state.suggestionJobs)) return state;
            const { [jobId]: _, ...rest } = state.suggestionJobs;
            return { suggestionJobs: rest };
          },
          false,
          'removeSuggestionJob'
        );
      },
    }),
    {
      name: 'research-store',
    }
  )
);
