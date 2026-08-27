import {
  FC,
  KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MODELS } from '../../config/models';
import { useGraphStructureStore } from '../../stores/graphStructureStore';
import { useNodeContentStore } from '../../stores/nodeContentStore';
import { useResearchStore } from '../../stores/researchStore';
import { estimateNextQuestionTokens } from '../../utils/contextEstimate';
import { nodeDocumentBytes, totalDocumentBytes } from '../../utils/documentBudget';
import { insertNewline } from '../../utils/insertNewline';
import { DictateButton } from '../ui/DictateButton';
import { DocumentLibrary } from '../ui/DocumentLibrary';
import { ModelPicker } from '../ui/ModelPicker';
import type { Document, TextSelection } from '../../types';
import { iconTooltip } from '../ui/TooltipLayer';

/**
 * Picker for the model applied to every new question. Opens upward since the
 * composer sits at the bottom of the pane.
 */
const ModelSelect: FC = () => {
  const [open, setOpen] = useState(false);
  const defaultModel = useResearchStore(s => s.defaultModel);
  const setDefaultModel = useResearchStore(s => s.setDefaultModel);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const current = MODELS.find(model => model.id === defaultModel) ?? MODELS[0];

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
        data-tooltip="Model for new questions"
      >
        {current.label}
        <svg
          className={`h-3 w-3 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1.5 w-64 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-xl">
          <div className="border-b border-stone-100 bg-stone-50 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-stone-400">
            Model for new questions
          </div>
          <div className="px-3 py-2.5">
            <ModelPicker selectedModel={defaultModel} onModelChange={setDefaultModel} />
            <div className="mt-2 text-[10px] text-stone-400">{current.description}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const GAUGE_RADIUS = 6;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

function formatTokens(count: number): string {
  if (count >= 1000000) return `${parseFloat((count / 1000000).toFixed(1))}M`;
  if (count >= 1000) return `${Math.round(count / 1000)}k`;
  return `${count}`;
}

/**
 * Ring meter showing how full the selected model's context window would be
 * for the next question: the whole tree context plus the draft and its staged
 * documents, estimated at ~4 chars/token to track the prompt the backend
 * assembles.
 */
const ContextGauge: FC<{ draftQuery: string; draftDocuments: Document[] }> = ({
  draftQuery,
  draftDocuments,
}) => {
  const nodes = useGraphStructureStore(s => s.nodes);
  const edges = useGraphStructureStore(s => s.edges);
  const nodeContents = useNodeContentStore(s => s.nodeContents);
  const brief = useResearchStore(s => s.brief);
  const caseDocuments = useResearchStore(s => s.caseDocuments);
  const readHistory = useResearchStore(s => s.readHistory);
  const defaultModel = useResearchStore(s => s.defaultModel);

  const model = MODELS.find(m => m.id === defaultModel) ?? MODELS[0];

  const tokens = useMemo(
    () =>
      estimateNextQuestionTokens({
        nodes,
        edges,
        nodeContents,
        brief,
        caseDocuments,
        readNodeIds: new Set(readHistory.map(event => event.nodeId)),
        draftQuery,
        draftDocuments,
      }),
    [nodes, edges, nodeContents, brief, caseDocuments, readHistory, draftQuery, draftDocuments]
  );

  const usage = Math.min(1, tokens / model.contextTokens);
  const percent = Math.round(usage * 100);
  const tone = usage >= 0.9 ? 'text-rose-600' : usage >= 0.7 ? 'text-amber-600' : 'text-stone-400';

  return (
    <div
      className={`flex cursor-default items-center gap-1 px-1.5 py-1 text-[11px] tabular-nums ${tone}`}
      data-tooltip={`Estimated context for the next question: ~${formatTokens(tokens)} of ${formatTokens(model.contextTokens)} tokens`}
      data-testid="context-gauge"
    >
      <svg className="h-3.5 w-3.5 -rotate-90" viewBox="0 0 16 16">
        <circle
          cx="8"
          cy="8"
          r={GAUGE_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="2.5"
        />
        <circle
          cx="8"
          cy="8"
          r={GAUGE_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeDasharray={`${usage * GAUGE_CIRCUMFERENCE} ${GAUGE_CIRCUMFERENCE}`}
        />
      </svg>
      {percent}%
    </div>
  );
};

/**
 * Chat-style composer at the bottom of the thread. Enter submits a child
 * question of the cursor (Shift+Enter and ⌘/Ctrl+Enter break the line). By
 * the creation invariant the input is enabled only when the cursor question is
 * read, when the tree is empty (which creates the root question), or while
 * composing a new root question (also a root). Documents staged via the
 * paperclip are attached to the question on submit.
 */
export const ThreadInput: FC = () => {
  const [value, setValue] = useState('');
  const [pendingDocuments, setPendingDocuments] = useState<Document[]>([]);
  // A select-to-ask quote pulled back by an Esc-abort, with the parent answer
  // its offsets index into. Re-attached on submit only while the cursor is
  // still on that parent (else the offsets would land in the wrong answer).
  const [pendingSelection, setPendingSelection] = useState<{
    selection: TextSelection;
    sourceNodeId: string;
  } | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Dictation: append transcribed speech to whatever is already in the draft.
  const appendDictation = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setValue(prev => (prev.trim() ? `${prev.replace(/\s+$/, '')} ${trimmed}` : trimmed));
  }, []);

  const cursorNodeId = useResearchStore(s => s.cursorNodeId);
  const composingRoot = useResearchStore(s => s.composingRoot);
  const cursorIsRead = useResearchStore(s =>
    s.cursorNodeId === null ? false : s.readHistory.some(event => event.nodeId === s.cursorNodeId)
  );
  const cursorJobStatus = useResearchStore(s =>
    s.cursorNodeId === null ? undefined : s.jobs[s.cursorNodeId]?.status
  );
  const submitQuestion = useResearchStore(s => s.submitQuestion);
  const restoredDraft = useResearchStore(s => s.restoredDraft);
  const clearRestoredDraft = useResearchStore(s => s.clearRestoredDraft);
  const treeEmpty = useGraphStructureStore(s => s.nodes.length === 0);

  const enabled =
    composingRoot || treeEmpty || (cursorNodeId !== null && cursorIsRead && !cursorJobStatus);

  const hint = enabled
    ? null
    : cursorJobStatus === 'streaming' || cursorJobStatus === 'queued'
      ? 'Follow-ups unlock when the answer finishes.'
      : cursorJobStatus === 'error'
        ? 'Retry the question above to continue this thread.'
        : cursorNodeId === null
          ? 'Select a question in the tree to continue a thread.'
          : 'Read the answer above to ask a follow-up here.';

  // Auto-grow up to ~6 lines
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
  }, [value]);

  // Focus the composer when the user opens a new root question
  useEffect(() => {
    if (composingRoot) textareaRef.current?.focus();
  }, [composingRoot]);

  // A question pulled back by an Esc-abort: reload its text and documents into
  // the composer and focus it, so the user can rewrite it or pick another model.
  useEffect(() => {
    if (!restoredDraft) return;
    setValue(restoredDraft.text);
    setPendingDocuments(restoredDraft.documents);
    setPendingSelection(
      restoredDraft.selection && restoredDraft.selectionSourceNodeId
        ? { selection: restoredDraft.selection, sourceNodeId: restoredDraft.selectionSourceNodeId }
        : null
    );
    clearRestoredDraft();
    textareaRef.current?.focus();
  }, [restoredDraft, clearRestoredDraft]);

  // The restored quote only applies while the cursor is still on the answer it
  // was taken from — submitQuestion branches a child of the cursor, so attaching
  // it anywhere else would anchor the highlight into the wrong text.
  const activeSelection =
    pendingSelection && pendingSelection.sourceNodeId === cursorNodeId
      ? pendingSelection.selection
      : null;

  const handleSubmit = () => {
    if (!enabled || !value.trim()) return;
    submitQuestion(value, activeSelection ?? undefined, pendingDocuments);
    setValue('');
    setPendingDocuments([]);
    setPendingSelection(null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter (and an Enter that only closes an IME candidate) inserts a newline
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    // ⌘/Ctrl+Enter is the other way to break the line instead of sending
    if (event.metaKey || event.ctrlKey) {
      insertNewline(event.currentTarget);
      return;
    }
    handleSubmit();
  };

  return (
    <div className="border-t border-stone-200 bg-paper px-4 py-3">
      <div className="mx-auto max-w-3xl">
        <div
          className={`rounded-2xl border px-3 pb-2 pt-2.5 transition-all ${
            enabled
              ? 'border-stone-300 bg-white focus-within:border-stone-500 focus-within:shadow-[0_2px_12px_rgba(28,25,23,0.07)]'
              : 'border-stone-200 bg-stone-100/60'
          }`}
        >
          {activeSelection && (
            <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.1em] text-amber-700">
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h10"
                    />
                  </svg>
                  About selected text
                </span>
                <button
                  type="button"
                  onClick={() => setPendingSelection(null)}
                  className="flex-shrink-0 rounded p-0.5 text-amber-600/70 transition-colors hover:bg-amber-100 hover:text-amber-800"
                  {...iconTooltip('Remove — ask without the selected text')}
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              <p className="mt-1 line-clamp-2 border-l-2 border-amber-300 pl-2 font-serif text-[12px] italic leading-snug text-stone-600">
                {activeSelection.text}
              </p>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={event => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!enabled}
            rows={1}
            placeholder={
              treeEmpty
                ? 'Ask your first question… (Enter to submit)'
                : composingRoot
                  ? 'Ask a new question… (Enter to submit)'
                  : 'Ask a follow-up question… (Enter to submit)'
            }
            className="max-h-[150px] w-full resize-none bg-transparent px-1 font-serif text-[15px] text-stone-800 placeholder:text-stone-400 focus:outline-none disabled:cursor-not-allowed"
            data-testid="thread-input"
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-0.5">
              <ModelSelect />
              <button
                onClick={() => setShowLibrary(true)}
                className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors hover:bg-stone-100 hover:text-stone-800 ${
                  pendingDocuments.length > 0 ? 'font-medium text-orange-700' : 'text-stone-400'
                }`}
                data-tooltip="Attach documents to this question"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                  />
                </svg>
                {pendingDocuments.length > 0 ? `${pendingDocuments.length} attached` : 'Attach'}
              </button>
              <DictateButton
                onTranscript={appendDictation}
                onError={setDictationError}
                disabled={!enabled}
                testId="thread-dictate"
              />
              <ContextGauge draftQuery={value} draftDocuments={pendingDocuments} />
            </div>
            <button
              onClick={handleSubmit}
              disabled={!enabled || !value.trim()}
              className="flex-shrink-0 rounded-full bg-stone-900 p-1.5 text-stone-50 transition-colors hover:bg-stone-700 disabled:bg-stone-200 disabled:text-stone-400"
              {...iconTooltip('Ask (Enter)')}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 10l7-7m0 0l7 7m-7-7v18"
                />
              </svg>
            </button>
          </div>
        </div>
        {hint && <div className="mt-1.5 px-1 text-[11px] text-stone-400">{hint}</div>}
        {dictationError && (
          <div className="mt-1.5 px-1 text-[11px] text-red-600">{dictationError}</div>
        )}
      </div>

      {showLibrary && (
        <DocumentLibrary
          documents={pendingDocuments}
          // Budget already taken by the case files and other questions'
          // attachments; a snapshot is fine — they cannot change while this
          // sheet is open.
          otherDocumentsBytes={
            nodeDocumentBytes(useNodeContentStore.getState().nodeContents) +
            totalDocumentBytes(useResearchStore.getState().caseDocuments)
          }
          onDocumentsChange={setPendingDocuments}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </div>
  );
};
