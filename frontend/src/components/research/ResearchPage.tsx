import { FC, useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useNavigationType, useParams } from 'react-router';
import { historyDepthOf } from '../../routes/caseNavigation';
import {
  NEW_QUESTION_SEGMENT,
  newQuestionPath,
  questionPath,
  resolveQuestionUrlId,
} from '../../routes/paths';
import { ErrorBoundary } from '../ErrorBoundary';
import { SettingsModal } from '../SettingsModal';
import { Sidebar } from '../Sidebar';
import { createNewGraph } from '../../services/autosaveService';
import { CASE_SAVE_CONFLICT_EVENT } from '../../services/autosaveSubscriptions';
import { researchGenerationService } from '../../services/researchGenerationService';
import { useGraphStructureStore } from '../../stores/graphStructureStore';
import { useResearchStore } from '../../stores/researchStore';
import { useUIStateStore } from '../../stores/uiStateStore';
import { FrontierPanel } from './FrontierPanel';
import { ThreadPane, clearThreadScrollPositions } from './ThreadPane';

/** Floating notice shown after a save conflict forced a reload of the case. */
const StaleCaseNotice: FC<{ onDismiss: () => void }> = ({ onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-full border border-stone-300 bg-white py-2 pl-4 pr-2 font-serif text-sm text-stone-700 shadow-lg">
        <span>
          This case was edited in another tab or window — reloaded to show the latest version.
        </span>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex h-6 w-6 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-600"
        >
          ×
        </button>
      </div>
    </div>
  );
};

/**
 * The research view: Frontier (question tree) on the left, Thread on the right.
 * A case is the same document entity as a graph.
 */
export const ResearchPage: FC = () => {
  const { graphId, questionId } = useParams<{ graphId?: string; questionId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();

  const loadGraphFromBackend = useGraphStructureStore(s => s.loadGraphFromBackend);

  const showSidebar = useUIStateStore(s => s.showSidebar);
  const setShowSidebar = useUIStateStore(s => s.setShowSidebar);
  const showSettingsModal = useUIStateStore(s => s.showSettingsModal);
  const setShowSettingsModal = useUIStateStore(s => s.setShowSettingsModal);
  const isLoadingGraph = useUIStateStore(s => s.isLoadingGraph);

  // Job state is part of what the page renders: gate on it like on the graph
  // itself, so questions generating server-side never flash as "never asked".
  const [jobsSynced, setJobsSynced] = useState(false);

  // Bumped when a save conflict proves this window stale; re-runs the load
  // effect below, which is exactly a case re-entry (reload + stream re-attach).
  const [reloadKey, setReloadKey] = useState(0);
  const [showStaleNotice, setShowStaleNotice] = useState(false);
  const dismissStaleNotice = useCallback(() => setShowStaleNotice(false), []);

  // A stale-case notice belongs to the case it fired on
  useEffect(() => {
    setShowStaleNotice(false);
  }, [graphId]);

  useEffect(() => {
    const handleConflict = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== graphId) return;
      setShowStaleNotice(true);
      setReloadKey(key => key + 1);
    };
    window.addEventListener(CASE_SAVE_CONFLICT_EVENT, handleConflict);
    return () => window.removeEventListener(CASE_SAVE_CONFLICT_EVENT, handleConflict);
  }, [graphId]);

  useEffect(() => {
    // API-key gate: suggestions, kickstarts and reports all run on OpenAI,
    // so the app is unusable without that key specifically
    if (!localStorage.getItem('openai_api_key')) {
      setShowSettingsModal(true);
    }

    // The graph selector is "usually hidden" in the research view
    setShowSidebar(false);

    let cancelled = false;
    setJobsSynced(false);

    if (graphId) {
      (async () => {
        try {
          await loadGraphFromBackend(graphId);
        } catch {
          if (!cancelled) navigate('/', { replace: true });
          return;
        }
        if (cancelled) return;
        // Attach to the graph's generation jobs: running ones resume
        // streaming into the view, finished ones are already in the graph.
        await researchGenerationService.open(graphId);
        if (!cancelled) setJobsSynced(true);
      })();
    }

    // Detach the job stream on graph switch and page unmount — the jobs
    // themselves run server-side and are unaffected.
    return () => {
      cancelled = true;
      researchGenerationService.close();
      clearThreadScrollPositions();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphId, reloadKey]);

  // Every question opened is a step in the browser's history; this tracks where
  // in that history the user stands, which is what greys out the ends.
  useEffect(() => {
    useResearchStore
      .getState()
      .setHistoryPosition(historyDepthOf(location), navigationType === 'PUSH');
  }, [location, navigationType]);

  // The address names the open question, so Back and Forward move through the
  // case. It leads whenever the browser moves the user — Back/Forward, a
  // reload, a link opened cold — and otherwise just catches up with the cursor.
  const caseLoaded = useResearchStore(s => s.caseId) === graphId;
  const caseRevision = useResearchStore(s => s.caseRevision);
  useEffect(() => {
    if (!graphId || !caseLoaded) return;
    const research = useResearchStore.getState();

    if (questionId === NEW_QUESTION_SEGMENT) {
      research.applyCursor(null, true);
      return;
    }

    const nodeIds = useGraphStructureStore.getState().nodes.map(node => node.id);
    const addressed = questionId ? resolveQuestionUrlId(questionId, nodeIds) : null;
    if (addressed) {
      research.applyCursor(addressed, false);
      return;
    }

    // Either the address names no question, or it names one that is gone —
    // deleted since, or typed by hand. Name what is on screen instead, over the
    // top of this entry, so stepping back keeps leading somewhere real. A case
    // just opened has nothing on screen yet, so it resumes where it left off.
    if (research.composingRoot) {
      navigate(newQuestionPath(graphId), { replace: true, state: location.state });
      return;
    }
    const landing = research.cursorNodeId ?? research.resumeQuestionId();
    if (landing) {
      navigate(questionPath(graphId, landing), { replace: true, state: location.state });
    }
  }, [graphId, questionId, caseLoaded, caseRevision, location, navigate]);

  // Esc aborts the in-flight answer back to the composer; ⌘[/⌘] (Ctrl on
  // non-mac) navigate the cursor history.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // An open modal owns Esc (closing itself) — don't also abort behind it.
        if (document.querySelector('.sheet-overlay-enter')) return;
        // A focused field owns Esc too (cancel an edit, close the selection
        // popup) — the answer composer is disabled while generating, so it can't
        // be the active element here.
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
        ) {
          return;
        }
        const research = useResearchStore.getState();
        const nodeId = research.cursorNodeId;
        if (!nodeId) return;
        const status = research.jobs[nodeId]?.status;
        if ((status === 'streaming' || status === 'queued') && !research.isRead(nodeId)) {
          event.preventDefault();
          research.abortQuestion(nodeId);
        }
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === '[') {
        event.preventDefault();
        useResearchStore.getState().goBack();
      } else if (event.key === ']') {
        event.preventDefault();
        useResearchStore.getState().goForward();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleNewCase = useCallback(async () => {
    try {
      const newGraphId = await createNewGraph();
      // A step forward, like every other way into a case: replacing the entry
      // instead would leave the case just left reachable through Forward.
      navigate(`/research/${newGraphId}`);
    } catch (error) {
      console.error('Failed to create a new case:', error);
      alert('Failed to create a new case. Please try again.');
    }
  }, [navigate]);

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-parchment">
        <Sidebar
          isOpen={showSidebar}
          onToggle={() => setShowSidebar(!showSidebar)}
          onNewGraph={handleNewCase}
          onSettings={() => setShowSettingsModal(true)}
          onClose={() => setShowSidebar(false)}
          currentGraphId={graphId}
          showToggle={false}
        />

        <div
          className={`flex min-w-0 flex-1 transition-all duration-300 ${
            showSidebar ? 'ml-64' : 'ml-0'
          }`}
        >
          {isLoadingGraph || (graphId && !jobsSynced) ? (
            <div className="flex flex-1 items-center justify-center font-serif text-sm text-stone-400">
              Loading case…
            </div>
          ) : (
            <>
              <FrontierPanel />
              <ThreadPane />
            </>
          )}
        </div>

        {showStaleNotice && <StaleCaseNotice onDismiss={dismissStaleNotice} />}

        <SettingsModal
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          onSave={() => setShowSettingsModal(false)}
        />
      </div>
    </ErrorBoundary>
  );
};
