import { FC, RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useNodeContentStore } from '../../stores/nodeContentStore';
import { useResearchStore } from '../../stores/researchStore';
import { nodeDocumentBytes } from '../../utils/documentBudget';
import { insertNewline } from '../../utils/insertNewline';
import {
  researchKickstartService,
  type KickstartDeclinedQuestion,
  type KickstartQuestion,
} from '../../services/researchKickstartService';
import { DECLINE_REASONS } from './declineReasons';
import { DocumentLibrary } from '../ui/DocumentLibrary';
import { DictateButton } from '../ui/DictateButton';
import type { DeclineReason, Document } from '../../types';
import { iconTooltip } from '../ui/TooltipLayer';

interface QuestionRow {
  id: string;
  text: string;
  fromUser: boolean;
  approved: boolean;
  enterDelay: number;
}

const NOTES_PLACEHOLDER = `What are you trying to figure out, and why does it matter?

Write freely — your goal, what you already know, what's fuzzy, hunches, constraints, the decision this feeds. Attach documents for context.

Already have questions? Paste them in (one per line): they'll appear in the list below, joined by new ones.`;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keeps a textarea's height matched to its content. */
function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [ref, value]);
}

const SparklesIcon: FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9.66 3.5l1.15 2.84 2.84 1.15-2.84 1.15-1.15 2.85-1.15-2.85-2.85-1.15 2.85-1.15L9.66 3.5zM17.5 11l.9 2.23 2.23.9-2.23.9-.9 2.22-.9-2.22-2.22-.9 2.22-.9.9-2.23zM8 15.5l.77 1.9 1.9.77-1.9.77-.77 1.9-.77-1.9-1.9-.77 1.9-.77.77-1.9z"
    />
  </svg>
);

const SpinnerIcon: FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
    />
  </svg>
);

const SectionLabel: FC<{ children: string }> = ({ children }) => (
  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
    {children}
  </span>
);

interface KickstartQuestionRowProps {
  row: QuestionRow;
  onToggle: () => void;
  onDecline: (reason: DeclineReason | null) => void;
  onEdit: (text: string) => void;
}

/**
 * One proposed kickoff question. Clicking decline morphs the row into reason
 * chips with an x in the same spot as the decline button — clicking it again
 * (or clicking away) declines without a reason, mirroring the thread's suggestion cards.
 * The pencil swaps the text for a textarea: Enter or blur saves, Escape cancels.
 */
const KickstartQuestionRow: FC<KickstartQuestionRowProps> = ({
  row,
  onToggle,
  onDecline,
  onEdit,
}) => {
  const [choosingReason, setChoosingReason] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // Card height at the moment of the decline click; the reason picker keeps it
  // so the second x sits exactly where the first one was clicked (long
  // questions wrap and would otherwise shrink the card)
  const [frozenHeight, setFrozenHeight] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(draftTextareaRef, draft);

  const startChoosingReason = () => {
    setFrozenHeight(cardRef.current?.offsetHeight ?? null);
    setChoosingReason(true);
  };

  const startEditing = () => {
    setDraft(row.text);
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== row.text) onEdit(trimmed);
  };

  // Click-away while choosing a reason = decline without one
  useEffect(() => {
    if (!choosingReason) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rowRef.current && !rowRef.current.contains(event.target as Node)) {
        onDecline(null);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [choosingReason, onDecline]);

  return (
    <div
      ref={rowRef}
      style={{ animationDelay: `${row.enterDelay}ms` }}
      className="kickstart-row-enter"
      data-testid="kickstart-question-row"
    >
      {choosingReason ? (
        <div
          className="flex items-center gap-2.5 rounded-lg border border-dashed border-stone-300 bg-stone-100/60 px-3 py-2"
          style={{ minHeight: frozenHeight ?? undefined }}
        >
          <span className="flex-shrink-0 text-[11px] text-stone-500">Why?</span>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {DECLINE_REASONS.map(({ reason, label, title, Icon }) => (
              <button
                key={reason}
                onClick={() => onDecline(reason)}
                data-tooltip={title}
                className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-white px-2 py-0.5 text-[11px] text-stone-600 hover:bg-stone-100 transition-colors"
              >
                <Icon className="h-3.5 w-3.5 flex-shrink-0 text-stone-500" />
                {label}
              </button>
            ))}
          </div>
          {/* Same spot as the decline button below: a second click skips the reason */}
          <button
            onClick={() => onDecline(null)}
            className="flex-shrink-0 rounded p-0.5 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-rose-600"
            {...iconTooltip('Decline without a reason')}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      ) : (
        <div
          ref={cardRef}
          onClick={editing ? undefined : onToggle}
          className={`group flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-all ${
            editing
              ? 'border-stone-500 bg-white shadow-[0_2px_8px_rgba(28,25,23,0.08)]'
              : row.approved
                ? 'cursor-pointer border-stone-400 bg-white shadow-[0_1px_4px_rgba(28,25,23,0.06)]'
                : 'cursor-pointer border-dashed border-stone-300 hover:border-stone-400'
          }`}
        >
          <span
            className={`mt-[3px] flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
              row.approved
                ? 'border-stone-900 bg-stone-900'
                : 'border-stone-300 bg-white group-hover:border-stone-500'
            }`}
          >
            <svg
              className={`h-2.5 w-2.5 ${row.approved ? 'text-stone-50' : 'text-transparent'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3.5}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </span>
          {editing ? (
            <textarea
              ref={draftTextareaRef}
              autoFocus
              rows={1}
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onBlur={commitEdit}
              onKeyDown={event => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  insertNewline(event.currentTarget);
                } else if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  commitEdit();
                } else if (event.key === 'Escape') {
                  // Keep the modal open — only leave edit mode
                  event.stopPropagation();
                  setEditing(false);
                }
              }}
              className="min-w-0 flex-1 resize-none bg-transparent font-serif text-[13px] leading-snug text-stone-800 focus:outline-none"
              data-testid="kickstart-question-edit-input"
            />
          ) : (
            <span
              className={`min-w-0 flex-1 font-serif text-[13px] leading-snug ${
                row.approved ? 'text-stone-800' : 'text-stone-500'
              }`}
            >
              {row.text}
            </span>
          )}
          {row.fromUser && !editing && (
            <span className="mt-[2px] flex-shrink-0 rounded-full border border-orange-200 bg-orange-50 px-1.5 py-px text-[9px] font-medium uppercase tracking-[0.12em] text-orange-700">
              yours
            </span>
          )}
          {!editing && (
            <button
              onClick={event => {
                event.stopPropagation();
                startEditing();
              }}
              className="mt-px flex-shrink-0 rounded p-0.5 text-stone-300 transition-colors hover:bg-stone-200/60 hover:text-stone-700"
              {...iconTooltip('Edit this question')}
              data-testid="kickstart-question-edit"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </button>
          )}
          {!editing && (
            <button
              onClick={event => {
                event.stopPropagation();
                startChoosingReason();
              }}
              className="mt-px flex-shrink-0 rounded p-0.5 text-stone-300 transition-colors hover:bg-stone-200/60 hover:text-rose-600"
              {...iconTooltip('Not interested — avoid this direction')}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Dashed "add your own" affordance under the question list. Enter adds the
 * question and keeps the box open for the next one; blur adds and closes;
 * Escape discards.
 */
const KickstartAddQuestion: FC<{ onAdd: (text: string) => void }> = ({ onAdd }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(textareaRef, text);

  const commit = (keepOpen: boolean) => {
    const trimmed = text.trim();
    if (trimmed) onAdd(trimmed);
    setText('');
    if (!keepOpen) setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-stone-300 px-3 py-2 text-left font-serif text-[13px] text-stone-400 transition-colors hover:border-stone-400 hover:text-stone-700"
        data-testid="kickstart-add-question"
      >
        <svg
          className="icon-optical h-3.5 w-3.5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
        </svg>
        Add your own question
      </button>
    );
  }

  return (
    <div className="flex items-start rounded-lg border border-stone-500 bg-white px-3 py-2 shadow-[0_2px_8px_rgba(28,25,23,0.08)]">
      <textarea
        ref={textareaRef}
        autoFocus
        rows={1}
        value={text}
        onChange={event => setText(event.target.value)}
        onBlur={() => commit(false)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            insertNewline(event.currentTarget);
          } else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            commit(true);
          } else if (event.key === 'Escape') {
            // Keep the modal open — only close the composer
            event.stopPropagation();
            setText('');
            setOpen(false);
          }
        }}
        placeholder="Type a question — Enter adds it"
        className="min-w-0 flex-1 resize-none bg-transparent font-serif text-[13px] leading-snug text-stone-800 placeholder:text-stone-400 focus:outline-none"
        data-testid="kickstart-add-question-input"
      />
    </div>
  );
};

interface KickstartModalProps {
  onClose: () => void;
}

/**
 * Kickoff modal for an empty case: freeform notes (plus documents) in,
 * a draft brief and a curated list of starting questions out. The two
 * generations are independent LLM calls fired in parallel; questions carry
 * three states — approved (checked), pending (shown, undecided), declined
 * (removed, anti-target for further generation).
 */
export const KickstartModal: FC<KickstartModalProps> = ({ onClose }) => {
  const applyKickstart = useResearchStore(s => s.applyKickstart);

  const [notes, setNotes] = useState('');

  // Dictation: append transcribed speech to whatever is already in the notes.
  const [dictationError, setDictationError] = useState<string | null>(null);
  const appendDictation = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setNotes(prev => (prev.trim() ? `${prev.replace(/\s+$/, '')} ${trimmed}` : trimmed));
  }, []);

  const [documents, setDocuments] = useState<Document[]>(
    () => useResearchStore.getState().caseDocuments
  );
  const [showLibrary, setShowLibrary] = useState(false);

  const [generated, setGenerated] = useState(false);
  const [briefText, setBriefText] = useState('');
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [declined, setDeclined] = useState<KickstartDeclinedQuestion[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  // Async handlers read list state through refs so a response merges against
  // what the user sees at arrival time, not at request time
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const declinedRef = useRef(declined);
  declinedRef.current = declined;
  const lastRequestMoreRef = useRef(false);

  const briefTextareaRef = useRef<HTMLTextAreaElement>(null);

  const approvedCount = rows.filter(row => row.approved).length;
  const dirty = notes.trim() !== '' || generated;

  const requestClose = useCallback(() => {
    if (dirty && !window.confirm('Discard this draft? Nothing has been added to the case yet.')) {
      return;
    }
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !showLibrary) {
        requestClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [requestClose, showLibrary]);

  // The brief grows with its content, up to a scroll cap
  useLayoutEffect(() => {
    const textarea = briefTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 300)}px`;
  }, [briefText, briefLoading, briefError]);

  const runBrief = async () => {
    setBriefLoading(true);
    setBriefError(null);
    try {
      const brief = await researchKickstartService.generateBrief(notes, documents);
      setBriefText(brief);
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : 'The brief could not be generated.');
    } finally {
      setBriefLoading(false);
    }
  };

  const mergeFetched = (fetched: KickstartQuestion[]): QuestionRow[] => {
    const taken = new Set(rowsRef.current.map(row => normalize(row.text)));
    declinedRef.current.forEach(d => taken.add(normalize(d.text)));

    const fresh: QuestionRow[] = [];
    for (const question of fetched) {
      const key = normalize(question.text);
      if (!key || taken.has(key)) continue;
      taken.add(key);
      fresh.push({
        id: crypto.randomUUID(),
        text: question.text,
        fromUser: question.fromUser,
        // The user literally wrote these — they arrive pre-selected
        approved: question.fromUser,
        enterDelay: fresh.length * 45,
      });
    }
    return fresh;
  };

  const runQuestions = async (requestMore: boolean) => {
    lastRequestMoreRef.current = requestMore;
    setQuestionsLoading(true);
    setQuestionsError(null);
    setExhausted(false);
    try {
      const fetched = await researchKickstartService.generateQuestions(
        notes,
        documents,
        briefText,
        {
          approved: rowsRef.current.filter(row => row.approved).map(row => row.text),
          pending: rowsRef.current.filter(row => !row.approved).map(row => row.text),
          declined: declinedRef.current,
        },
        requestMore
      );
      const fresh = mergeFetched(fetched);
      setRows([...rowsRef.current, ...fresh]);
      setExhausted(fresh.length === 0);
    } catch (err) {
      setQuestionsError(err instanceof Error ? err.message : 'Questions could not be generated.');
    } finally {
      setQuestionsLoading(false);
    }
  };

  const handleGenerate = () => {
    if (!notes.trim()) return;
    setGenerated(true);
    void runBrief();
    void runQuestions(false);
  };

  const toggleRow = (id: string) => {
    setRows(prev => prev.map(row => (row.id === id ? { ...row, approved: !row.approved } : row)));
  };

  const declineRow = (id: string, reason: DeclineReason | null) => {
    const row = rows.find(r => r.id === id);
    if (!row) return;
    setRows(prev => prev.filter(r => r.id !== id));
    setDeclined(prev => [...prev, { text: row.text, reason }]);
  };

  const editRow = (id: string, text: string) => {
    // Rewriting into a question that was declined earlier revokes that decline
    setDeclined(prev => prev.filter(d => normalize(d.text) !== normalize(text)));
    // Rewriting a question is a clear signal of interest — approve it
    setRows(prev => prev.map(row => (row.id === id ? { ...row, text, approved: true } : row)));
  };

  const addRow = (text: string) => {
    const key = normalize(text);
    // Typing a question that's already in the list just approves the existing row
    const existing = rows.find(row => normalize(row.text) === key);
    if (existing) {
      setRows(prev => prev.map(row => (row.id === existing.id ? { ...row, approved: true } : row)));
      return;
    }
    // Re-adding a previously declined question by hand revokes the decline
    setDeclined(prev => prev.filter(d => normalize(d.text) !== key));
    setRows(prev => [
      ...prev,
      { id: crypto.randomUUID(), text, fromUser: true, approved: true, enterDelay: 0 },
    ]);
  };

  const selectAll = () => {
    setRows(prev => prev.map(row => ({ ...row, approved: true })));
  };

  const canConfirm =
    !briefLoading && !questionsLoading && (approvedCount > 0 || briefText.trim() !== '');

  const confirmLabel =
    approvedCount > 0
      ? `Add ${approvedCount} question${approvedCount === 1 ? '' : 's'}`
      : briefText.trim()
        ? 'Save brief'
        : 'Add questions';

  const handleConfirm = () => {
    if (!canConfirm) return;
    applyKickstart({
      brief: briefText.trim(),
      documents,
      approvedQuestions: rows.filter(row => row.approved).map(row => row.text),
      declinedQuestions: declined,
    });
    onClose();
  };

  return ReactDOM.createPortal(
    <div
      className="sheet-overlay-enter fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-[2px]"
      onMouseDown={event => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div className="sheet-enter flex max-h-[86vh] w-[680px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-paper shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-6 pb-4 pt-5">
          <div>
            <h2 className="font-serif text-xl text-stone-800">Generate questions</h2>
            <p className="mt-0.5 font-serif text-[12.5px] text-stone-500">
              Tell it what you're chasing — it drafts the brief and proposes where to start.
            </p>
          </div>
          <button
            onClick={requestClose}
            className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700"
            {...iconTooltip('Close')}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Notes */}
          <div className="rounded-xl border border-stone-300 bg-white px-3 pb-2 pt-2.5 transition-all focus-within:border-stone-500 focus-within:shadow-[0_2px_12px_rgba(28,25,23,0.07)]">
            <textarea
              value={notes}
              onChange={event => setNotes(event.target.value)}
              rows={7}
              autoFocus
              placeholder={NOTES_PLACEHOLDER}
              className="max-h-[260px] w-full resize-none bg-transparent px-1 font-serif text-[14px] leading-relaxed text-stone-800 placeholder:text-stone-400 focus:outline-none"
              data-testid="kickstart-notes"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowLibrary(true)}
                  className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors hover:bg-stone-100 hover:text-stone-800 ${
                    documents.length > 0 ? 'font-medium text-orange-700' : 'text-stone-400'
                  }`}
                  data-tooltip="Attach documents to the case"
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
                      d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                    />
                  </svg>
                  {documents.length > 0 ? `${documents.length} attached` : 'Attach'}
                </button>
                <DictateButton
                  onTranscript={appendDictation}
                  onError={setDictationError}
                  testId="kickstart-dictate"
                />
              </div>
              {!generated && (
                <button
                  onClick={handleGenerate}
                  disabled={!notes.trim()}
                  className="flex items-center gap-2 rounded-full bg-stone-900 py-2 pl-3.5 pr-4 font-serif text-[13px] text-stone-50 shadow-sm transition-colors hover:bg-stone-700 disabled:bg-stone-200 disabled:text-stone-400"
                  data-testid="kickstart-generate"
                >
                  <SparklesIcon className="h-3.5 w-3.5 text-orange-400" />
                  Generate brief & questions
                </button>
              )}
            </div>
            {dictationError && (
              <p className="mt-1 px-1 text-[11px] text-red-600">{dictationError}</p>
            )}
          </div>

          {/* Brief */}
          {generated && (
            <div className="mt-5">
              <div className="mb-1.5 flex items-center justify-between">
                <SectionLabel>Brief</SectionLabel>
                {!briefLoading && (
                  <button
                    onClick={() => void runBrief()}
                    disabled={!notes.trim()}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700 disabled:opacity-40"
                    data-tooltip="Rewrite the brief from your notes"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    Regenerate
                  </button>
                )}
              </div>
              {briefLoading ? (
                <div className="px-2 py-1.5">
                  <div className="kickstart-skeleton h-3 w-full rounded" />
                  <div className="kickstart-skeleton mt-2 h-3 w-[92%] rounded" />
                  <div className="kickstart-skeleton mt-2 h-3 w-[78%] rounded" />
                  <div className="mt-2.5 font-serif text-[11px] text-stone-400">
                    Drafting the brief…
                  </div>
                </div>
              ) : briefError ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2">
                  <span className="min-w-0 text-[12px] text-rose-700">{briefError}</span>
                  <button
                    onClick={() => void runBrief()}
                    className="flex-shrink-0 rounded border border-rose-200 bg-white px-2 py-0.5 text-[11px] text-rose-700 transition-colors hover:bg-rose-50"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <textarea
                  ref={briefTextareaRef}
                  value={briefText}
                  onChange={event => setBriefText(event.target.value)}
                  placeholder="The drafted brief lands here — edit freely; it feeds every answer."
                  className="max-h-[300px] w-full resize-none overflow-y-auto rounded-lg border border-transparent bg-transparent px-2 py-1.5 font-serif text-[13px] leading-relaxed text-stone-700 transition-colors placeholder:text-stone-400 hover:border-stone-200 focus:border-stone-400 focus:bg-white focus:outline-none"
                  data-testid="kickstart-brief"
                />
              )}
            </div>
          )}

          {/* Starting questions */}
          {generated && (
            <div className="mt-5">
              <div className="mb-1.5 flex items-center justify-between">
                <SectionLabel>Starting questions</SectionLabel>
                <div className="flex items-center gap-2.5">
                  {rows.some(row => !row.approved) && (
                    <button
                      onClick={selectAll}
                      className="text-[11px] text-stone-400 underline-offset-2 transition-colors hover:text-stone-700 hover:underline"
                    >
                      Select all
                    </button>
                  )}
                  {rows.length > 0 && (
                    <span className="text-[11px] text-stone-400">
                      {approvedCount} of {rows.length} selected
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                {rows.map(row => (
                  <KickstartQuestionRow
                    key={row.id}
                    row={row}
                    onToggle={() => toggleRow(row.id)}
                    onDecline={reason => declineRow(row.id, reason)}
                    onEdit={text => editRow(row.id, text)}
                  />
                ))}

                {questionsLoading && rows.length === 0 && (
                  <>
                    {[0, 1, 2].map(index => (
                      <div
                        key={index}
                        className="rounded-lg border border-dashed border-stone-200 px-3 py-2.5"
                      >
                        <div
                          className="kickstart-skeleton h-3 rounded"
                          style={{ width: `${85 - index * 11}%` }}
                        />
                      </div>
                    ))}
                    <div className="px-1 pt-1 font-serif text-[11px] text-stone-400">
                      Proposing questions…
                    </div>
                  </>
                )}

                {questionsError && (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2">
                    <span className="min-w-0 text-[12px] text-rose-700">{questionsError}</span>
                    <button
                      onClick={() => void runQuestions(lastRequestMoreRef.current)}
                      className="flex-shrink-0 rounded border border-rose-200 bg-white px-2 py-0.5 text-[11px] text-rose-700 transition-colors hover:bg-rose-50"
                    >
                      Try again
                    </button>
                  </div>
                )}

                {!(questionsLoading && rows.length === 0) && (
                  <KickstartAddQuestion onAdd={addRow} />
                )}
              </div>

              {!questionsError && (rows.length > 0 || (!questionsLoading && exhausted)) && (
                <button
                  onClick={() => void runQuestions(true)}
                  disabled={questionsLoading}
                  className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-stone-300 px-3 py-2 font-serif text-[12.5px] text-stone-500 transition-colors hover:border-stone-400 hover:bg-white/60 hover:text-stone-800 disabled:cursor-default disabled:opacity-60"
                  data-testid="kickstart-more"
                >
                  {questionsLoading ? (
                    <>
                      <SpinnerIcon className="h-3.5 w-3.5 text-orange-600" />
                      Proposing more…
                    </>
                  ) : (
                    <>
                      <SparklesIcon className="h-3.5 w-3.5" />
                      Generate more questions
                    </>
                  )}
                </button>
              )}

              {exhausted && !questionsLoading && (
                <div className="mt-1.5 text-center font-serif text-[11px] text-stone-400">
                  No new directions found — add detail to your notes and try again.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-stone-200 px-6 py-3.5">
          <button
            onClick={requestClose}
            className="rounded-md px-2 py-1 text-[13px] text-stone-500 transition-colors hover:text-stone-800"
          >
            Cancel
          </button>
          <div className="flex items-center gap-3">
            {declined.length > 0 && (
              <span className="text-[11px] text-stone-400">{declined.length} declined</span>
            )}
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="rounded-full bg-stone-900 px-5 py-2 font-serif text-[13.5px] text-stone-50 shadow-sm transition-colors hover:bg-stone-700 disabled:bg-stone-200 disabled:text-stone-400"
              data-testid="kickstart-confirm"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>

      {showLibrary && (
        <DocumentLibrary
          documents={documents}
          // This list replaces the case files on confirm, so only the
          // questions' attachments count against the budget here.
          otherDocumentsBytes={nodeDocumentBytes(useNodeContentStore.getState().nodeContents)}
          onDocumentsChange={setDocuments}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </div>,
    document.body
  );
};
