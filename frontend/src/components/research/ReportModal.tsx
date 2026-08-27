import { FC, useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useGraphStructureStore } from '../../stores/graphStructureStore';
import { researchReportService } from '../../services/researchReportService';
import { iconTooltip } from '../ui/TooltipLayer';

type Status = 'idle' | 'loading' | 'done' | 'error';

interface ReportModalProps {
  onClose: () => void;
}

function reportFilename(name: string | null): string {
  const base = (name ?? '').trim();
  const slug = base
    .replace(/[^\p{L}\p{N}\-_ ]/gu, '')
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${slug || 'case-report'}.md`;
}

/**
 * Generates and shows the case's Markdown report. Opens straight into
 * a generating state, then renders the report with copy / download / regenerate.
 */
export const ReportModal: FC<ReportModalProps> = ({ onClose }) => {
  const name = useGraphStructureStore(s => s.name);
  // Opens on an intro screen; generation starts only when the user asks for it,
  // so a slow, billed LLM call never fires from merely opening the modal.
  const [status, setStatus] = useState<Status>('idle');
  const [markdown, setMarkdown] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  // Optional steer for what the report should focus on; persists across
  // regenerations so a fresh take keeps the same focus.
  const [guidance, setGuidance] = useState('');

  const generate = useCallback(async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      const md = await researchReportService.generateReport(guidance);
      setMarkdown(md);
      setStatus('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'The report could not be generated.');
      setStatus('error');
    }
  }, [guidance]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = reportFilename(name);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      console.error('Failed to copy report:', err);
    }
  };

  const headerButton =
    'rounded-md px-2.5 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-200/70 hover:text-stone-900';

  return (
    <div
      className="sheet-overlay-enter fixed inset-0 z-[80] flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-paper shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <svg
              className="h-4 w-4 flex-shrink-0 text-stone-500"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span className="truncate font-serif text-[15px] font-medium text-stone-800">
              Case report
            </span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {status === 'done' && (
              <>
                <button onClick={handleCopy} className={headerButton} data-tooltip="Copy Markdown">
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={handleDownload}
                  className={headerButton}
                  data-tooltip="Download as .md"
                >
                  Download .md
                </button>
                <button
                  onClick={() => void generate()}
                  className={headerButton}
                  data-tooltip="Generate a fresh report"
                >
                  Regenerate
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="ml-1 rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-200/70 hover:text-stone-700"
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
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {status === 'idle' && (
            <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-8 text-center">
              <svg
                className="h-10 w-10 text-stone-400"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <div className="space-y-2 font-serif text-sm leading-relaxed text-stone-600">
                <p>
                  This writes a Markdown report of your whole case — not a flat summary, but the
                  story of what you found.
                </p>
                <p>
                  It reads your brief, the order you explored questions, the passages you{' '}
                  <span className="rounded-[3px] bg-yellow-200/70 px-0.5">highlighted</span> as
                  insights, and the suggestions you declined — to foreground what mattered to you
                  and leave out what didn't.
                </p>
              </div>
              <div className="w-full space-y-1.5 text-left">
                <label
                  htmlFor="report-guidance"
                  className="block font-serif text-xs font-medium text-stone-500"
                >
                  Focus the report (optional)
                </label>
                <textarea
                  id="report-guidance"
                  value={guidance}
                  onChange={event => setGuidance(event.target.value)}
                  rows={3}
                  placeholder="e.g. Focus on the cost trade-offs and leave out the background."
                  className="w-full resize-none rounded-md border border-stone-200 bg-white px-3 py-2 font-serif text-sm text-stone-700 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none"
                />
              </div>
              <button
                onClick={() => void generate()}
                className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700"
              >
                Generate report
              </button>
              <span className="text-xs text-stone-400">This can take up to a minute.</span>
            </div>
          )}

          {status === 'loading' && (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-stone-400">
              <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span className="font-serif text-sm">Reading your case and writing the report…</span>
            </div>
          )}

          {status === 'error' && (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
              <div className="max-w-md font-serif text-sm text-rose-600">{errorMsg}</div>
              <button
                onClick={() => void generate()}
                className="rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-stone-700"
              >
                Try again
              </button>
            </div>
          )}

          {status === 'done' && (
            <div className="prose prose-stone max-w-none font-serif prose-headings:font-serif prose-headings:text-stone-800 prose-p:text-stone-700 prose-li:text-stone-700">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                disallowedElements={['img']}
                components={{
                  a: ({ node, ...props }: any) => (
                    <a target="_blank" rel="noopener noreferrer" {...props} />
                  ),
                }}
              >
                {markdown}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
