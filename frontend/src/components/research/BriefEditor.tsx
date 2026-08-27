import { FC, useLayoutEffect, useRef, useState } from 'react';
import { useNodeContentStore } from '../../stores/nodeContentStore';
import { useResearchStore } from '../../stores/researchStore';
import { nodeDocumentBytes } from '../../utils/documentBudget';
import { DocumentLibrary } from '../ui/DocumentLibrary';

/**
 * The case brief: the standing context feeding every answer and
 * suggestion, plus the case-level document library. Grows with its
 * content up to a scroll cap — generated briefs run longer than two sentences.
 */
export const BriefEditor: FC = () => {
  const brief = useResearchStore(s => s.brief);
  const setBrief = useResearchStore(s => s.setBrief);
  const caseDocuments = useResearchStore(s => s.caseDocuments);
  const setCaseDocuments = useResearchStore(s => s.setCaseDocuments);
  const [showLibrary, setShowLibrary] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  }, [brief, collapsed]);

  return (
    <div className="border-b border-stone-200 px-3 py-2.5">
      <div className={`flex items-center justify-between ${collapsed ? '' : 'mb-1'}`}>
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 hover:text-stone-600 transition-colors"
          data-tooltip={collapsed ? 'Expand brief' : 'Collapse brief'}
        >
          <svg
            className={`w-2.5 h-2.5 transition-transform ${collapsed ? '-rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          Brief
        </button>
        <button
          onClick={() => setShowLibrary(true)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-stone-400 hover:bg-stone-200/60 hover:text-stone-700 transition-colors"
          data-tooltip="Case files"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
            />
          </svg>
          {caseDocuments.length > 0 ? `Docs (${caseDocuments.length})` : 'Docs'}
        </button>
      </div>
      {!collapsed && (
        <textarea
          ref={textareaRef}
          value={brief}
          onChange={event => setBrief(event.target.value)}
          placeholder="Your goal, the audience, what you already know."
          rows={2}
          className="max-h-[240px] w-full resize-none overflow-y-auto rounded border border-transparent bg-transparent px-1 py-0.5 font-serif text-[13px] leading-relaxed text-stone-700 placeholder:text-stone-400 hover:border-stone-200 focus:border-stone-400 focus:bg-white focus:outline-none transition-colors"
        />
      )}

      {showLibrary && (
        <DocumentLibrary
          documents={caseDocuments}
          // Budget already taken by per-question attachments; a snapshot is
          // fine — they cannot change while this sheet is open.
          otherDocumentsBytes={nodeDocumentBytes(useNodeContentStore.getState().nodeContents)}
          onDocumentsChange={setCaseDocuments}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </div>
  );
};
