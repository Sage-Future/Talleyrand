import { FC, useEffect } from 'react';

interface ShareCaseModalProps {
  caseName: string;
  /** Names of the case files that the link hands out along with the case. */
  documentNames: string[];
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Asked before a case first goes public. Spells out what a link hands over —
 * the whole case, the attached files included — because a reader can save
 * their own copy, files and all, and that copy is theirs to keep.
 */
export const ShareCaseModal: FC<ShareCaseModalProps> = ({
  caseName,
  documentNames,
  onConfirm,
  onClose,
}) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="sheet-overlay-enter fixed inset-0 z-[80] flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-paper shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="border-b border-stone-200 px-5 py-3">
          <span className="font-serif text-[15px] font-medium text-stone-800">
            Share “{caseName}” by link?
          </span>
        </div>

        <div className="space-y-3 px-5 py-4 font-serif text-[13.5px] leading-relaxed text-stone-600">
          <p>
            Anyone with the link can read the whole case without signing in — your brief, every
            question, every answer, and the suggestions still open.
          </p>

          {documentNames.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-3">
              <p className="text-stone-700">
                The {documentNames.length === 1 ? 'file' : `${documentNames.length} files`} you
                attached {documentNames.length === 1 ? 'goes' : 'go'} out with it:
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {documentNames.map(name => (
                  <li key={name} className="truncate text-[13px] text-stone-600">
                    · {name}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[13px] text-stone-600">
                Readers can save their own copy of the case, and your files travel into that copy —
                where they stay as context for everything the new owner asks.
              </p>
            </div>
          ) : (
            <p>Files you attach to this case later go out with the link too.</p>
          )}

          <p className="text-[13px] text-stone-500">
            What you read and when stays private. You can stop sharing at any time, but copies
            people already made stay with them.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-stone-200 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 font-serif text-[13px] text-stone-600 transition-colors hover:bg-stone-200/70 hover:text-stone-900"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-stone-900 px-4 py-1.5 font-serif text-[13px] text-stone-50 transition-colors hover:bg-stone-700"
          >
            Share and copy link
          </button>
        </div>
      </div>
    </div>
  );
};
