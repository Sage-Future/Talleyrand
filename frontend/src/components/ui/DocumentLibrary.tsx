import React, { FC, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import type { Document } from '../../types';
import { iconTooltip } from './TooltipLayer';
import {
  MAX_CASE_DOCUMENT_BYTES,
  documentBytes,
  formatMegabytes,
  textBytes,
  totalDocumentBytes,
} from '../../utils/documentBudget';

interface DocumentLibraryProps {
  documents: Document[];
  /**
   * Stored bytes already taken by documents elsewhere in the case (other
   * questions' attachments, or the case files when editing a question's
   * attachments). Additions are capped so the whole case — one MongoDB
   * document — stays under MAX_CASE_DOCUMENT_BYTES of attached content.
   */
  otherDocumentsBytes: number;
  onDocumentsChange: (documents: Document[]) => void;
  onClose: () => void;
}

interface DocumentFormProps {
  document?: Document;
  /** Room left in the case's document budget for this document's content. */
  maxContentBytes: number;
  onSave: (document: Document) => void;
  onCancel: () => void;
}

function formatDocumentMeta(doc: Document): string {
  if (doc.type === 'pdf') {
    const base64 = doc.content.slice(doc.content.indexOf(',') + 1);
    const bytes = base64.length * 0.75;
    return bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  const words = doc.content.trim() ? doc.content.trim().split(/\s+/).length : 0;
  return `${words} word${words === 1 ? '' : 's'}`;
}

const SectionLabel: FC<{ children: string }> = ({ children }) => (
  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
    {children}
  </span>
);

const DocumentForm: FC<DocumentFormProps> = ({ document, maxContentBytes, onSave, onCancel }) => {
  const [name, setName] = useState(document?.name || '');
  const [content, setContent] = useState(document?.content || '');
  const [sizeError, setSizeError] = useState<string | null>(null);

  const handleSave = () => {
    if (!name.trim()) return;
    const trimmedContent = content.trim();
    const bytes = textBytes(trimmedContent);
    if (bytes > maxContentBytes) {
      setSizeError(
        `This document is ${formatMegabytes(bytes)}, but the case has ${formatMegabytes(
          Math.max(0, maxContentBytes)
        )} of document space left (${formatMegabytes(MAX_CASE_DOCUMENT_BYTES)} per case).`
      );
      return;
    }
    onSave({
      id: document?.id ?? crypto.randomUUID(),
      name: name.trim(),
      type: 'txt',
      content: trimmedContent,
    });
  };

  return ReactDOM.createPortal(
    <div className="sheet-overlay-enter fixed inset-0 z-[70] flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-[2px]">
      <div className="sheet-enter flex max-h-[86vh] w-[560px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-paper shadow-2xl">
        <div className="border-b border-stone-200 px-6 pb-4 pt-5">
          <h2 className="font-serif text-xl text-stone-800">
            {document ? 'Edit document' : 'Write a document'}
          </h2>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          <div>
            <div className="mb-1.5">
              <SectionLabel>Name</SectionLabel>
            </div>
            <input
              type="text"
              value={name}
              onChange={event => setName(event.target.value)}
              autoFocus
              placeholder="What to call this source…"
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-serif text-[13.5px] text-stone-800 transition-all placeholder:text-stone-400 focus:border-stone-500 focus:shadow-[0_2px_12px_rgba(28,25,23,0.07)] focus:outline-none"
            />
          </div>

          <div className="flex flex-1 flex-col">
            <div className="mb-1.5">
              <SectionLabel>Content</SectionLabel>
            </div>
            <textarea
              value={content}
              onChange={event => {
                setContent(event.target.value);
                setSizeError(null);
              }}
              placeholder="Paste or write the text…"
              className="min-h-[260px] w-full flex-1 resize-y rounded-lg border border-stone-300 bg-white px-3 py-2 font-serif text-[13px] leading-relaxed text-stone-700 transition-all placeholder:text-stone-400 focus:border-stone-500 focus:shadow-[0_2px_12px_rgba(28,25,23,0.07)] focus:outline-none"
            />
            {sizeError && (
              <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2 text-[12px] leading-relaxed text-rose-700">
                {sizeError}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-stone-200 px-6 py-3.5">
          <button
            onClick={onCancel}
            className="rounded-md px-2 py-1 text-[13px] text-stone-500 transition-colors hover:text-stone-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="rounded-full bg-stone-900 px-5 py-2 font-serif text-[13.5px] text-stone-50 shadow-sm transition-colors hover:bg-stone-700 disabled:bg-stone-200 disabled:text-stone-400"
          >
            Save document
          </button>
        </div>
      </div>
    </div>,
    window.document.body
  );
};

/**
 * The document library sheet: drop or browse files (.txt/.md/.pdf), or write a
 * document by hand. Shared by the case brief, question composer, and
 * kickstart modal. Every path that adds content enforces the case-wide
 * document budget (MAX_CASE_DOCUMENT_BYTES), counting what is already
 * attached elsewhere in the case via otherDocumentsBytes.
 */
export const DocumentLibrary: FC<DocumentLibraryProps> = ({
  documents,
  otherDocumentsBytes,
  onDocumentsChange,
  onClose,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [editingDocument, setEditingDocument] = useState<Document | undefined>();
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);

  // Esc peels one layer: the form first, then the library
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showForm) {
        setShowForm(false);
        setEditingDocument(undefined);
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showForm, onClose]);

  const ingestFiles = async (files: FileList) => {
    const fresh: Document[] = [];
    const errors: string[] = [];
    let usedBytes = otherDocumentsBytes + totalDocumentBytes(documents);

    for (const file of Array.from(files)) {
      try {
        let document: Document;
        if (file.name.endsWith('.txt') || file.name.endsWith('.md')) {
          document = {
            id: crypto.randomUUID(),
            name: file.name.replace(/\.(txt|md)$/, ''),
            type: 'txt',
            content: await file.text(),
          };
        } else if (file.name.endsWith('.pdf')) {
          // Base64 encoding only inflates, so a file bigger than the whole
          // budget can be rejected without reading it into memory.
          if (file.size > MAX_CASE_DOCUMENT_BYTES) {
            errors.push(
              `"${file.name}" is too large (${formatMegabytes(file.size)}) — a case holds up to ${formatMegabytes(MAX_CASE_DOCUMENT_BYTES)} of documents.`
            );
            continue;
          }
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
          document = {
            id: crypto.randomUUID(),
            name: file.name.replace(/\.pdf$/, ''),
            type: 'pdf',
            content: dataUrl, // "data:application/pdf;base64,..."
          };
        } else {
          errors.push(`"${file.name}" — only .txt, .md and .pdf are supported.`);
          continue;
        }

        const bytes = documentBytes(document);
        if (usedBytes + bytes > MAX_CASE_DOCUMENT_BYTES) {
          errors.push(
            bytes > MAX_CASE_DOCUMENT_BYTES
              ? `"${file.name}" is too large (${formatMegabytes(bytes)} once stored) — a case holds up to ${formatMegabytes(MAX_CASE_DOCUMENT_BYTES)} of documents.`
              : `Not enough room for "${file.name}" (${formatMegabytes(bytes)} once stored) — ${formatMegabytes(MAX_CASE_DOCUMENT_BYTES - usedBytes)} of the case's ${formatMegabytes(MAX_CASE_DOCUMENT_BYTES)} document space is left.`
          );
          continue;
        }
        usedBytes += bytes;
        fresh.push(document);
      } catch (error) {
        console.error(`Failed to read file ${file.name}:`, error);
        errors.push(`Failed to read "${file.name}".`);
      }
    }

    setUploadErrors(errors);
    if (fresh.length > 0) {
      onDocumentsChange([...documents, ...fresh]);
    }
  };

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      void ingestFiles(event.target.files);
    }
    event.target.value = '';
  };

  const handleDragEnter = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setDragActive(false);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (event.dataTransfer.files.length > 0) {
      void ingestFiles(event.dataTransfer.files);
    }
  };

  const handleSaveDocument = (document: Document) => {
    onDocumentsChange(
      editingDocument
        ? documents.map(doc => (doc.id === document.id ? document : doc))
        : [...documents, document]
    );
    setShowForm(false);
    setEditingDocument(undefined);
  };

  return (
    <>
      {ReactDOM.createPortal(
        <div
          className="sheet-overlay-enter fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-[2px]"
          onMouseDown={event => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <div className="sheet-enter flex max-h-[82vh] w-[600px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-paper shadow-2xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-6 pb-4 pt-5">
              <div>
                <h2 className="font-serif text-xl text-stone-800">Documents</h2>
                <p className="mt-0.5 font-serif text-[12.5px] text-stone-500">
                  They ride along as context for answers and suggestions.
                </p>
              </div>
              <button
                onClick={onClose}
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
              {/* Drop zone */}
              <div
                onDragEnter={handleDragEnter}
                onDragOver={event => event.preventDefault()}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`rounded-xl border border-dashed px-4 py-5 text-center transition-colors ${
                  dragActive ? 'border-orange-400 bg-orange-50/50' : 'border-stone-300'
                }`}
              >
                <svg
                  className={`mx-auto h-5 w-5 ${dragActive ? 'text-orange-500' : 'text-stone-400'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3-3m0 0l3 3m-3-3v9"
                  />
                </svg>
                <div className="mt-2 font-serif text-[13px] text-stone-600">
                  Drop files here, or{' '}
                  <label className="cursor-pointer font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 transition-colors hover:decoration-stone-600">
                    browse
                    <input
                      type="file"
                      accept=".txt,.md,.pdf"
                      multiple
                      onChange={handleFileInput}
                      className="hidden"
                    />
                  </label>
                </div>
                <div className="mt-0.5 text-[11px] text-stone-400">
                  .txt, .md or .pdf · up to {formatMegabytes(MAX_CASE_DOCUMENT_BYTES)} of documents
                  per case
                </div>
              </div>

              {/* Upload errors */}
              {uploadErrors.length > 0 && (
                <div className="mt-3 flex items-start justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2">
                  <div className="min-w-0 text-[12px] leading-relaxed text-rose-700">
                    {uploadErrors.map((error, index) => (
                      <div key={index}>{error}</div>
                    ))}
                  </div>
                  <button
                    onClick={() => setUploadErrors([])}
                    className="flex-shrink-0 rounded p-0.5 text-rose-400 transition-colors hover:bg-rose-100 hover:text-rose-700"
                    {...iconTooltip('Dismiss')}
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
                        strokeWidth={2.5}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              )}

              {/* Document list */}
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <SectionLabel>
                    {documents.length === 0 ? 'Attached' : `Attached · ${documents.length}`}
                  </SectionLabel>
                  <button
                    onClick={() => {
                      setEditingDocument(undefined);
                      setShowForm(true);
                    }}
                    className="text-[11px] text-stone-400 underline-offset-2 transition-colors hover:text-stone-700 hover:underline"
                  >
                    Write by hand
                  </button>
                </div>

                {documents.length === 0 ? (
                  <div className="py-5 text-center font-serif text-[12.5px] text-stone-400">
                    No documents yet — drop a file above, or write one by hand.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {documents.map(doc => (
                      <div
                        key={doc.id}
                        className="group flex items-start gap-2.5 rounded-lg border border-stone-200 bg-white px-3 py-2 shadow-[0_1px_3px_rgba(28,25,23,0.04)] transition-colors hover:border-stone-300"
                      >
                        <span
                          className={`mt-[3px] flex-shrink-0 rounded border px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.12em] ${
                            doc.type === 'pdf'
                              ? 'border-orange-200 bg-orange-50 text-orange-700'
                              : 'border-stone-200 bg-stone-100 text-stone-500'
                          }`}
                        >
                          {doc.type}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span
                              className="truncate font-serif text-[13px] font-medium text-stone-800"
                              data-tooltip={doc.name}
                            >
                              {doc.name}
                            </span>
                            <span className="flex-shrink-0 text-[10.5px] text-stone-400">
                              {formatDocumentMeta(doc)}
                            </span>
                          </div>
                          {doc.type === 'txt' && doc.content && (
                            <p className="mt-0.5 line-clamp-2 font-serif text-[12px] leading-snug text-stone-500">
                              {doc.content}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          {doc.type === 'txt' && (
                            <button
                              onClick={() => {
                                setEditingDocument(doc);
                                setShowForm(true);
                              }}
                              className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
                              {...iconTooltip('Edit')}
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
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                />
                              </svg>
                            </button>
                          )}
                          <button
                            onClick={() =>
                              onDocumentsChange(documents.filter(d => d.id !== doc.id))
                            }
                            className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-rose-600"
                            {...iconTooltip('Remove')}
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
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end border-t border-stone-200 px-6 py-3.5">
              <button
                onClick={onClose}
                className="rounded-full bg-stone-900 px-5 py-2 font-serif text-[13.5px] text-stone-50 shadow-sm transition-colors hover:bg-stone-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        window.document.body
      )}
      {showForm && (
        <DocumentForm
          document={editingDocument}
          // A rewritten document replaces its old version, so its current
          // bytes are credited back to the budget.
          maxContentBytes={
            MAX_CASE_DOCUMENT_BYTES -
            otherDocumentsBytes -
            totalDocumentBytes(documents.filter(doc => doc.id !== editingDocument?.id))
          }
          onSave={handleSaveDocument}
          onCancel={() => {
            setShowForm(false);
            setEditingDocument(undefined);
          }}
        />
      )}
    </>
  );
};
