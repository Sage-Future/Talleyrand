import type { components } from '../api/schema';
import {
  client,
  createJobStreamUrl,
  getVerbosity,
  isParentSummaryEnabled,
  isWebSearchEnabled,
} from '../client';
import { useGraphStructureStore } from '../stores/graphStructureStore';
import { useNodeContentStore } from '../stores/nodeContentStore';
import { useResearchStore } from '../stores/researchStore';
import type { ModelType, ResearchSuggestion, WebSource } from '../types';
import { queueJobAck, saveNow } from './autosaveSubscriptions';
import { researchSuggestionService } from './researchSuggestionService';

// Server-side cap on concurrently running background generations.
const DEFAULT_BACKGROUND_CONCURRENCY = 5;
// One reconnect attempt per interval while the job stream is down.
const RECONNECT_DELAY_MS = 2000;

export function getBackgroundConcurrency(): number {
  const stored = Number(localStorage.getItem('background_concurrency'));
  return Number.isInteger(stored) && stored >= 1 ? stored : DEFAULT_BACKGROUND_CONCURRENCY;
}

type JobInfo = components['schemas']['JobDTO'];

type JobStreamEvent =
  | { type: 'snapshot'; jobId: string; nodeId: string; status: 'queued' | 'running'; text: string }
  | { type: 'started'; jobId: string; nodeId: string }
  | { type: 'delta'; jobId: string; nodeId: string; data: string }
  | {
      type: 'done';
      jobId: string;
      nodeId: string;
      answer: string;
      answeredAt: string;
      sources: WebSource[];
      sourcesFound: number;
    }
  | {
      type: 'job_error';
      jobId: string;
      kind: 'answer' | 'suggestions' | 'big_picture' | 'cheat_sheet';
      nodeId: string | null;
      data: string;
    }
  | { type: 'suggestions'; jobId: string; data: ResearchSuggestion[] }
  // The whole life of a parent cheat sheet: running while it generates, done
  // with the Markdown, error when it died (the header falls back to the thread).
  | {
      type: 'cheat_sheet';
      jobId: string;
      nodeId: string;
      status: 'running' | 'done' | 'error';
      data: string | null;
    }
  // Sent once per connection, after replayed snapshots and stored terminal
  // states: everything before it is sync, everything after is live.
  | { type: 'synced' }
  | { type: 'keepalive' };

/**
 * Client of the server-owned generation jobs. Generation runs and persists on
 * the backend regardless of this client's lifetime; this service only starts
 * jobs, mirrors their state into researchStore, and acknowledges incorporated
 * results so the server can retire their records.
 *
 * Invariants:
 * - a question node is saved (awaited) before its generation starts, so the
 *   server always builds context from a doc that contains it;
 * - completed answers enter nodeContents only from terminal payloads — the
 *   stream view is render-only state in researchStore.streamTexts;
 * - errors live in job state with a retry affordance, never in `response`.
 */
class ResearchGenerationService {
  private graphId: string | null = null;
  private ws: WebSocket | null = null;
  // Bumped on every open/close; async continuations from a previous graph
  // (or a StrictMode-discarded mount) check it and stand down.
  private generation = 0;

  /**
   * Connect the job event stream for a freshly loaded graph. The connection
   * replays complete job state (running snapshots, stored terminal results)
   * before going live; resolves once that replay has been applied.
   */
  async open(graphId: string): Promise<void> {
    this.close();
    this.graphId = graphId;
    await this.connect(graphId, this.generation);
  }

  /** Detach from the current graph. Server-side jobs are unaffected. */
  close(): void {
    this.generation++;
    this.graphId = null;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      ws.close();
    }
  }

  /** Start (or queue) generation for a question node. No-op if a job is already known. */
  ask(nodeId: string, options: { background: boolean; force?: boolean }): void {
    const research = useResearchStore.getState();
    if (research.jobs[nodeId]) return;
    const content = useNodeContentStore.getState().getNodeContent(nodeId);
    if (!content.query.trim() || content.response) return;

    const graphId = this.graphId;
    if (!graphId) {
      research.setJob(nodeId, { status: 'error', message: 'No case loaded.' });
      return;
    }

    research.setJob(nodeId, { status: options.background ? 'queued' : 'streaming' });
    void this.startAnswerJob(graphId, nodeId, options.background, options.force ?? false);
  }

  /**
   * Retry a node's answer generation, abandoning whatever is there now — a
   * failed attempt, or one that appears frozen (stuck 'streaming'/'queued'
   * and never completing). A frozen job is still live server-side, so the
   * restart is forced: the server cancels the stuck task and starts fresh.
   * An error job has no live task, so the restart is an ordinary re-ask.
   */
  retry(nodeId: string): void {
    const research = useResearchStore.getState();
    const job = research.jobs[nodeId];
    if (!job) return;
    const force = job.status !== 'error';
    research.setJob(nodeId, null);
    research.clearStreamText(nodeId);
    this.ask(nodeId, { background: false, force });
  }

  /**
   * Discard a node's completed answer and generate it again with the given
   * model. The save below still carries the old answer, so the server retires
   * any unacknowledged record for the node (implicit ack or supersede) before
   * the question is re-opened — clearing the response first would let the
   * overlay force the stale record's answer back into the doc.
   *
   * On a failed generation this is a retry with the picked model: there is no
   * answer to discard, and the generate POST replaces the error record.
   */
  async regenerate(nodeId: string, model: ModelType): Promise<void> {
    const gen = this.generation;
    const job = useResearchStore.getState().jobs[nodeId];
    if (job?.status === 'error') {
      useNodeContentStore.getState().setNodeModel(nodeId, model);
      useResearchStore.getState().setJob(nodeId, null);
      this.ask(nodeId, { background: false });
      return;
    }
    if (job) return;
    if (!useNodeContentStore.getState().getNodeContent(nodeId).response) return;

    try {
      await saveNow();
    } catch (err) {
      console.error('Regeneration cancelled — failed to save the case:', err);
      return;
    }
    if (gen !== this.generation) return;
    if (!useGraphStructureStore.getState().getNode(nodeId)) return;
    if (useResearchStore.getState().jobs[nodeId]) return;
    if (!useNodeContentStore.getState().getNodeContent(nodeId).response) return;

    // Re-open the question in one update: the old answer, its metadata and its
    // quote anchors all describe text that is being replaced. The backend reads
    // the model from the saved node, so setting it here is the whole switch.
    useNodeContentStore.getState().setNodeContent(nodeId, {
      selectedModel: model,
      response: '',
      answeredAt: null,
      selections: [],
      sources: [],
      sourcesFound: 0,
    });
    this.ask(nodeId, { background: false });
  }

  /**
   * Flush the local deletion of an Esc-aborted question to the server now, so
   * its job record is pruned and the running generation cancelled immediately
   * rather than after the autosave debounce — the point of the abort is to stop
   * a heavy model without waiting. The node was already removed from the stores
   * by researchStore.abortQuestion; this only persists that removal.
   */
  cancelAbortedGeneration(): void {
    void saveNow().catch(err =>
      console.error('Failed to flush aborted generation to the server:', err)
    );
  }

  /** Drop local job state for deleted nodes; the deletion's save prunes the server side. */
  discardLocalJobs(nodeIds: string[]): void {
    const research = useResearchStore.getState();
    for (const nodeId of nodeIds) {
      research.setJob(nodeId, null);
      research.clearStreamText(nodeId);
      research.setCheatSheetPending(nodeId, false);
    }
  }

  /** Apply a changed concurrency limit immediately (starts queued jobs that now fit). */
  concurrencyChanged(): void {
    void client
      .POST('/research/jobs/concurrency', {
        body: { limit: getBackgroundConcurrency() },
      })
      .then(({ error }) => {
        if (error) console.error('Failed to update generation concurrency:', error);
      })
      .catch(err => {
        console.error('Failed to update generation concurrency:', err);
      });
  }

  private async startAnswerJob(
    graphId: string,
    nodeId: string,
    background: boolean,
    force: boolean
  ): Promise<void> {
    const gen = this.generation;
    try {
      // The job builds its context from the saved doc: the question node (and
      // the latest brief/read history) must be persisted before it starts.
      await saveNow();
      if (gen !== this.generation) return;
      // The node may have been deleted during the save — e.g. an Esc-abort of
      // this very question. Don't start a server job for a node that's gone.
      if (!useGraphStructureStore.getState().getNode(nodeId)) return;

      const { data, error } = await client.POST('/research/{graph_id}/node/{node_id}/generate', {
        params: { path: { graph_id: graphId, node_id: nodeId } },
        body: {
          background,
          force,
          webSearchEnabled: isWebSearchEnabled(),
          verbosity: getVerbosity(),
          concurrencyLimit: getBackgroundConcurrency(),
          cheatSheet: isParentSummaryEnabled(),
        },
      });
      if (gen !== this.generation) return;
      if (error || !data) {
        throw new Error(extractErrorDetail(error) ?? 'Failed to start generation.');
      }
      this.applyJob(data, { liveCompletion: true });
    } catch (err) {
      if (gen !== this.generation) return;
      if (!useGraphStructureStore.getState().getNode(nodeId)) return; // deleted meanwhile
      const message = err instanceof Error ? err.message : 'Failed to start generation.';
      useResearchStore.getState().setJob(nodeId, { status: 'error', message });
    }
  }

  /** Mirror a job DTO into the stores; terminal payloads are incorporated and acked. */
  private applyJob(job: JobInfo, { liveCompletion }: { liveCompletion: boolean }): void {
    const research = useResearchStore.getState();

    if (job.kind !== 'answer') {
      if (job.status === 'done') {
        research.addSuggestions(job.id, job.suggestions ?? []);
      } else if (job.status === 'error') {
        // Suggestion failures are silent ("suggest more" is the manual
        // recovery); ack so the record doesn't linger.
        console.error('Suggestion generation failed:', job.error);
        this.ackJob(job.id);
      }
      return;
    }

    const nodeId = job.nodeId;
    // A job of a node this client no longer has (deleted here, or a different
    // graph was loaded into the stores) must not resurrect store entries; the
    // deletion's save prunes its record server-side.
    if (!nodeId || !useGraphStructureStore.getState().getNode(nodeId)) return;
    const current = research.jobs[nodeId];
    switch (job.status) {
      case 'queued':
        // The optimistic ask() state already shows 'queued'; never regress a
        // state that stream events may have advanced in the meantime.
        break;
      case 'running':
        if (current?.status === 'queued' || current?.status === 'streaming') {
          research.setJob(nodeId, { status: 'streaming' });
        }
        break;
      case 'done':
        this.incorporateAnswer(
          nodeId,
          job.answer ?? '',
          job.answeredAt ?? null,
          job.sources,
          job.sourcesFound,
          { liveCompletion }
        );
        break;
      case 'error':
        research.setJob(nodeId, { status: 'error', message: job.error ?? 'Generation failed.' });
        research.clearStreamText(nodeId);
        break;
    }
  }

  private incorporateAnswer(
    nodeId: string,
    answer: string,
    answeredAt: string | null,
    sources: WebSource[],
    sourcesFound: number,
    { liveCompletion }: { liveCompletion: boolean }
  ): void {
    const contentStore = useNodeContentStore.getState();
    const research = useResearchStore.getState();

    const responseChanged = contentStore.getNodeContent(nodeId).response !== answer;
    if (responseChanged) {
      contentStore.setNodeResponse(nodeId, answer);
    }
    // Sources belong to this answer: a regeneration replaces them wholesale.
    contentStore.setNodeContent(nodeId, {
      answeredAt: answeredAt ?? undefined,
      sources,
      sourcesFound,
    });
    research.setJob(nodeId, null);
    research.clearStreamText(nodeId);

    // The record is retired by the implicit ack: the next save's payload
    // carries the answer, which the content change above just scheduled.

    // Captured before onAnswerCompleted: a live first completion marks the
    // node read in there, which must not look like a regeneration below.
    const wasRead = research.isRead(nodeId);

    if (liveCompletion) {
      // The user watched this answer finish; on a sync after reload, reading
      // happens when the answer is actually displayed (CurrentAnswer).
      research.onAnswerCompleted(nodeId);
    }

    if (responseChanged && wasRead) {
      // A new answer on an already-read node is a regenerated one, and the
      // first-read suggestion trigger won't re-fire for it — request
      // suggestions here. The fetch saves first, which also acks this
      // answer's record.
      void researchSuggestionService.fetchSuggestions(nodeId, false);
    }
  }

  /**
   * Condense the thread above a question on demand: for questions answered
   * before "summarize parents" was on, and to refresh a sheet whose thread has
   * moved on. The answer flow starts the same job by itself; results arrive on
   * the stream either way.
   */
  async generateCheatSheet(nodeId: string): Promise<void> {
    const graphId = this.graphId;
    if (!graphId) return;
    const research = useResearchStore.getState();
    if (research.cheatSheetPending[nodeId]) return;
    research.setCheatSheetPending(nodeId, true);
    try {
      // The job condenses the saved thread: pending edits (a just-read answer,
      // an edited brief) must be in the doc before it reads them.
      await saveNow();
      const { error } = await client.POST('/research/{graph_id}/node/{node_id}/cheat-sheet', {
        params: { path: { graph_id: graphId, node_id: nodeId } },
      });
      if (error) throw new Error(extractErrorDetail(error) ?? 'Failed to start.');
    } catch (err) {
      console.error('Failed to start cheat sheet generation:', err);
      useResearchStore.getState().setCheatSheetPending(nodeId, false);
    }
  }

  /** Fold a completed cheat sheet into its question and ack the record. */
  private incorporateCheatSheet(nodeId: string, cheatSheet: string, jobId: string): void {
    useNodeContentStore.getState().setNodeContent(nodeId, { cheatSheet });
    useResearchStore.getState().setCheatSheetPending(nodeId, false);
    this.ackJob(jobId);
  }

  /**
   * Queue a job record's explicit ack. For suggestions this is called by
   * researchStore at the moment a batch is incorporated; for cheat sheets, at
   * the moment the sheet enters node content (answer records ack implicitly).
   */
  ackJob(jobId: string): void {
    if (this.graphId) {
      queueJobAck(this.graphId, jobId);
    }
  }

  /** Resolves once the replayed job state has been applied (or the socket closed). */
  private async connect(graphId: string, gen: number): Promise<void> {
    // Each connection is opened with its own freshly minted ticket; an
    // expired session surfaces here as a 401, which the HTTP layer turns
    // into a refresh or the re-login flow.
    let url: string | null;
    try {
      url = await createJobStreamUrl(graphId);
    } catch (err) {
      if (gen !== this.generation) return;
      console.error('Failed to open the live answer stream:', err);
      this.reconnectLater(graphId, gen);
      return;
    }
    if (gen !== this.generation) return;
    if (url === null) return; // case deleted, or the session is over

    return new Promise(resolve => {
      const ws = new WebSocket(url);
      this.ws = ws;
      // Terminal events before the 'synced' marker replay history; only
      // completions after it were watched live (and count as read).
      let live = false;

      ws.onmessage = event => {
        if (gen !== this.generation) return;
        const parsed = JSON.parse(event.data) as JobStreamEvent;
        if (parsed.type === 'synced') {
          live = true;
          resolve();
          return;
        }
        this.handleEvent(parsed, live);
      };

      ws.onclose = closeEvent => {
        resolve();
        if (gen !== this.generation) return;
        this.ws = null;
        if (closeEvent.code === 4004) {
          return; // graph deleted; no stream to reconnect to
        }
        // 4001 (the ticket expired in flight) is a reconnect like any other:
        // minting the next ticket is what decides whether the session lives.
        this.reconnectLater(graphId, gen);
      };
    });
  }

  /** Reopen the stream after a pause; the attach replay re-syncs the gap. */
  private reconnectLater(graphId: string, gen: number): void {
    setTimeout(() => {
      if (gen !== this.generation) return;
      void this.open(graphId);
    }, RECONNECT_DELAY_MS);
  }

  private handleEvent(event: JobStreamEvent, live: boolean): void {
    const research = useResearchStore.getState();
    const nodeExists = (nodeId: string) => !!useGraphStructureStore.getState().getNode(nodeId);
    switch (event.type) {
      case 'snapshot':
        if (!nodeExists(event.nodeId)) break;
        research.setJob(event.nodeId, {
          status: event.status === 'queued' ? 'queued' : 'streaming',
        });
        research.setStreamText(event.nodeId, event.text);
        break;
      case 'started':
        if (!nodeExists(event.nodeId)) break;
        research.setJob(event.nodeId, { status: 'streaming' });
        break;
      case 'delta':
        if (!nodeExists(event.nodeId)) break;
        research.appendStreamText(event.nodeId, event.data);
        break;
      case 'done':
        if (!nodeExists(event.nodeId)) break;
        this.incorporateAnswer(
          event.nodeId,
          event.answer,
          event.answeredAt,
          event.sources,
          event.sourcesFound,
          { liveCompletion: live }
        );
        break;
      case 'job_error':
        if (event.kind === 'answer' && event.nodeId) {
          if (!nodeExists(event.nodeId)) break;
          research.setJob(event.nodeId, { status: 'error', message: event.data });
          research.clearStreamText(event.nodeId);
        } else {
          console.error('Suggestion generation failed:', event.data);
          this.ackJob(event.jobId);
          research.removeSuggestionJob(event.jobId);
        }
        break;
      case 'suggestions':
        research.addSuggestions(event.jobId, event.data);
        research.removeSuggestionJob(event.jobId);
        break;
      case 'cheat_sheet':
        if (!nodeExists(event.nodeId)) break;
        if (event.status === 'running') {
          research.setCheatSheetPending(event.nodeId, true);
        } else if (event.status === 'done' && event.data) {
          this.incorporateCheatSheet(event.nodeId, event.data, event.jobId);
        } else {
          // Nothing to show and nothing to retry: the header falls back to the
          // thread itself. The record retires with the next save.
          console.error('Cheat sheet generation failed:', event.data);
          research.setCheatSheetPending(event.nodeId, false);
        }
        break;
      case 'keepalive':
        break;
    }
  }
}

function extractErrorDetail(error: unknown): string | null {
  if (error && typeof error === 'object' && 'detail' in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
  }
  return null;
}

export const researchGenerationService = new ResearchGenerationService();
