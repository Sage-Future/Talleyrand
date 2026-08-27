import type { GraphData } from '../types';
import { useGraphStructureStore } from '../stores/graphStructureStore';
import { useNodeContentStore } from '../stores/nodeContentStore';
import { useResearchStore, type ResearchPersistedState } from '../stores/researchStore';
import { useUIStateStore } from '../stores/uiStateStore';
import * as autosaveService from './autosaveService';
import { generateGraphName } from './autoNamingService';

// Event emitted when a graph is auto-named, so UI can refresh
export const GRAPH_AUTO_NAMED_EVENT = 'graph-auto-named';

// Event emitted when a save is rejected because another window saved a newer
// revision (detail: the graph id). The page owning the case reloads it —
// including re-attaching the generation stream — which this module can't do.
export const CASE_SAVE_CONFLICT_EVENT = 'case-save-conflict';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 1500;

// Graph has its default name — the user hasn't manually renamed it
function isUnnamedGraph(name: string | null): boolean {
  return name === null || name === 'New case';
}

let autoNamingInFlight = false;

// Auto-naming waits until the case has real substance. Naming off the
// very first answer fires on a thin signal and surprises the user mid-first-
// question (and races the answer landing in the saved payload, so it fired
// inconsistently); require a couple of completed answers before naming.
const MIN_ANSWERS_FOR_AUTO_NAMING = 2;

/**
 * Auto-name the graph after a successful save, once it has actual content —
 * at least MIN_ANSWERS_FOR_AUTO_NAMING completed answers (a research node's
 * response is written only when its generation job completes, so a non-empty
 * response in the payload is always a finished one). Running off the save
 * guarantees the naming endpoint reads what was just saved, never a stale
 * pre-debounce copy.
 */
async function maybeAutoNameGraph(savedGraph: GraphData): Promise<void> {
  if (autoNamingInFlight) return;
  if (!isUnnamedGraph(savedGraph.name)) return;
  const answeredCount = savedGraph.nodeContents.filter(content => content.response).length;
  if (answeredCount < MIN_ANSWERS_FOR_AUTO_NAMING) return;

  autoNamingInFlight = true;
  try {
    const name = await generateGraphName(savedGraph.id);
    // The user may have switched graphs or renamed manually in the meantime
    const structureStore = useGraphStructureStore.getState();
    if (!name || structureStore.id !== savedGraph.id || !isUnnamedGraph(structureStore.name)) {
      return;
    }
    structureStore.setName(name);
    await autosaveService.renameGraph(savedGraph.id, name);
    // Emit event so UI (e.g., Sidebar) can refresh
    window.dispatchEvent(new CustomEvent(GRAPH_AUTO_NAMED_EVENT));
  } catch (err) {
    console.error('Failed to auto-name graph:', err);
  } finally {
    autoNamingInFlight = false;
  }
}

// Generation-job acks awaiting a save of their graph. A save that carries an
// ack proves to the server that its payload incorporates that job's results.
let pendingAckGraphId: string | null = null;
const pendingAckIds = new Set<string>();

export function queueJobAck(graphId: string, jobId: string): void {
  if (pendingAckGraphId !== graphId) {
    pendingAckGraphId = graphId;
    pendingAckIds.clear();
  }
  pendingAckIds.add(jobId);
  debouncedAutosave();
}

function takeAcksFor(graphId: string): string[] {
  if (pendingAckGraphId !== graphId) return [];
  return [...pendingAckIds];
}

/** Snapshot the stores and PUT the graph. Skips silently while a load is in progress. */
async function executeSave(): Promise<void> {
  const uiState = useUIStateStore.getState();
  const structureStore = useGraphStructureStore.getState();

  // Skip autosave while loading a graph
  if (uiState.isLoadingGraph) {
    return;
  }

  // Skip autosave if graph has no name (not saved yet)
  if (!structureStore.name) {
    return;
  }

  const graphData = structureStore.getGraph();
  const acks = takeAcksFor(graphData.id);
  let saved: { id: string; revision: number } | undefined;
  try {
    saved = await autosaveService.saveToBackend(graphData, acks);
  } catch (error) {
    if (error instanceof autosaveService.SaveConflictError) {
      // This snapshot is stale by definition — drop the pending debounce and
      // let the page reload the latest revision. A save already queued behind
      // this one may still fire once with the same stale revision; the server
      // rejects it the same way, so it only re-raises this event.
      cancelPendingAutosave();
      window.dispatchEvent(new CustomEvent(CASE_SAVE_CONFLICT_EVENT, { detail: graphData.id }));
    }
    throw error;
  }
  if (!saved) {
    // saveNow()'s contract is "resolved means persisted" — generation starts
    // depend on it, so a failed PUT must reject, not resolve. Rejections the
    // server explains (409 conflict, 413 too large) already threw above with
    // their own user-facing message; this covers the rest.
    throw new Error('Failed to save the case.');
  }
  // Adopt the server's revision so the next save builds on this one; guarded
  // because the user may have switched cases while the PUT was in flight.
  const structureStoreNow = useGraphStructureStore.getState();
  if (structureStoreNow.id === graphData.id) {
    structureStoreNow.setRevision(saved.revision);
  }
  acks.forEach(id => pendingAckIds.delete(id));
  void maybeAutoNameGraph(graphData);
}

// Saves are single-flight and coalesced: at most one PUT on the wire, at most
// one queued behind it. saveNow() resolves after a save whose snapshot was
// taken at-or-after the call — callers may rely on "my state is persisted".
let runningSave: Promise<void> | null = null;
let pendingSave: {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
} | null = null;

function startSave(): Promise<void> {
  const save = executeSave().finally(() => {
    // Synchronous handoff: the pending save starts before anyone can observe
    // an idle queue, so two saves never overlap or reorder.
    runningSave = null;
    if (pendingSave) {
      const next = pendingSave;
      pendingSave = null;
      startSave().then(next.resolve, next.reject);
    }
  });
  runningSave = save;
  return save;
}

export function saveNow(): Promise<void> {
  if (!runningSave) {
    return startSave();
  }
  if (!pendingSave) {
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    pendingSave = { promise, resolve, reject };
  }
  return pendingSave.promise;
}

function debouncedAutosave() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    saveNow().catch(error => {
      console.error('Autosave failed:', error);
    });
  }, DEBOUNCE_MS);
}

/**
 * Cancel any pending debounced autosave without executing it.
 * Use after bulk store updates (e.g., loadGraph) to discard
 * spurious debounce triggers from intermediate state changes.
 */
export function cancelPendingAutosave() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  // Acks belong to the graph being unloaded; the records they target stay
  // server-side and are re-delivered (and re-acked) on the next load.
  pendingAckGraphId = null;
  pendingAckIds.clear();
}

/**
 * Immediately flush any pending debounced autosave. Call before loading a new
 * graph or on page unload. Goes through the single-flight queue: two PUTs for
 * one graph must never be in flight at once, or a stale snapshot processed
 * second could overwrite a fresher one (and, via the implicit answer ack of
 * the fresher save, permanently lose a just-completed answer). The snapshot
 * is taken synchronously when the queue is idle; when a save is already
 * running, the trailing save covers whatever state exists once it starts.
 */
export function flushAutosave() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    saveNow().catch(error => {
      console.error('Autosave failed:', error);
    });
  }
}

export function initAutosaveSubscriptions() {
  // Track previous state for comparison
  let prevNodes = useGraphStructureStore.getState().nodes;
  let prevEdges = useGraphStructureStore.getState().edges;
  let prevNodeContents = useNodeContentStore.getState().nodeContents;

  // Subscribe to graph structure changes (nodes, edges)
  useGraphStructureStore.subscribe(state => {
    if (state.nodes !== prevNodes || state.edges !== prevEdges) {
      prevNodes = state.nodes;
      prevEdges = state.edges;
      debouncedAutosave();
    }
  });

  // Subscribe to node content changes
  useNodeContentStore.subscribe(state => {
    if (state.nodeContents !== prevNodeContents) {
      prevNodeContents = state.nodeContents;
      debouncedAutosave();
    }
  });

  // Subscribe to the research store's persisted slice
  const pickResearchPersisted = (state: ResearchPersistedState): ResearchPersistedState => ({
    brief: state.brief,
    caseDocuments: state.caseDocuments,
    suggestions: state.suggestions,
    declinedQuestions: state.declinedQuestions,
    readHistory: state.readHistory,
  });
  let prevResearch = pickResearchPersisted(useResearchStore.getState());

  useResearchStore.subscribe(state => {
    if (
      state.brief !== prevResearch.brief ||
      state.caseDocuments !== prevResearch.caseDocuments ||
      state.suggestions !== prevResearch.suggestions ||
      state.declinedQuestions !== prevResearch.declinedQuestions ||
      state.readHistory !== prevResearch.readHistory
    ) {
      prevResearch = pickResearchPersisted(state);
      debouncedAutosave();
    }
  });

  // Flush pending autosave on page unload/reload
  window.addEventListener('beforeunload', flushAutosave);
}
