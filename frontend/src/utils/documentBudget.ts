import type { Document, NodeContent } from '../types';

/**
 * A case is persisted as ONE MongoDB document (16 MB BSON hard cap), and
 * attached documents ride inside it — PDFs as base64 data URLs (~4/3 the raw
 * file size), text as-is. Their combined stored size is capped well below the
 * Mongo limit so questions, answers and highlights always have room. The
 * backend enforces its own larger cap (HTTP 413) as the hard stop.
 */
export const MAX_CASE_DOCUMENT_BYTES = 12 * 1024 * 1024;

const encoder = new TextEncoder();

/** UTF-8 size of a text — what the string occupies once stored. */
export function textBytes(text: string): number {
  return encoder.encode(text).length;
}

/** Stored size of one document's content. */
export function documentBytes(doc: Document): number {
  // PDF content is a base64 data URL — pure ASCII, so length equals bytes.
  return doc.type === 'pdf' ? doc.content.length : textBytes(doc.content);
}

export function totalDocumentBytes(documents: Document[]): number {
  return documents.reduce((sum, doc) => sum + documentBytes(doc), 0);
}

/** Stored bytes taken by documents attached to the case's questions. */
export function nodeDocumentBytes(nodeContents: Record<string, NodeContent>): number {
  return Object.values(nodeContents).reduce(
    (sum, content) => sum + totalDocumentBytes(content.documents),
    0
  );
}

export function formatMegabytes(bytes: number): string {
  return `${parseFloat((bytes / 1024 / 1024).toFixed(1))} MB`;
}
