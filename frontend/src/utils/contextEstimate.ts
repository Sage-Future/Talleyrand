/**
 * Client-side estimate of the prompt the next research question would send.
 *
 * Mirrors the backend prompt assembly (features/research/context_builder.py,
 * build_research_context): brief, case documents, the whole
 * case tree with answers only for read questions, the draft as a new
 * open question, and the CURRENT QUESTION footer. Characters are counted without building the
 * prompt string and converted at ~4 chars/token. PDFs enter the request as
 * separate attachments and are excluded from the backend's context-usage
 * metric, so here they likewise contribute only their placeholder line.
 */

import type { GraphNode } from '../stores/graphStructureStore';
import type { Document, Edge, NodeContent } from '../types';
import { buildQuestionTree } from './questionTree';

const CHARS_PER_TOKEN = 4;

interface NextQuestionContext {
  nodes: GraphNode[];
  edges: Edge[];
  nodeContents: Record<string, NodeContent>;
  brief: string;
  caseDocuments: Document[];
  readNodeIds: ReadonlySet<string>;
  draftQuery: string;
  draftDocuments: Document[];
}

/** Estimated prompt tokens for asking the draft question right now. */
export function estimateNextQuestionTokens(context: NextQuestionContext): number {
  let chars = 0;
  // Counts one prompt line: segment lengths plus the joining newline. Large
  // fields (answers, document contents) pass as their own segment so no big
  // string is ever allocated.
  const line = (...segments: string[]) => {
    for (const segment of segments) chars += segment.length;
    chars += 1;
  };

  const documentLines = (documents: Document[]) => {
    line('    DOCUMENTS:');
    for (const doc of documents) {
      if (doc.type === 'txt') line(`      - ${doc.name}: `, doc.content);
      else line(`      - ${doc.name}.pdf: [PDF file attached]`);
    }
  };

  if (context.brief.trim()) line('BRIEF:\n', context.brief.trim(), '\n');

  if (context.caseDocuments.length > 0) {
    line('CASE DOCUMENTS:');
    for (const doc of context.caseDocuments) {
      if (doc.type === 'txt') line(`  - ${doc.name}: `, doc.content);
      else line(`  - ${doc.name}.pdf: [PDF file attached]`);
    }
    line('');
  }

  const tree = buildQuestionTree(context.nodes, context.edges);

  line("CASE TREE (fixed order; the user's case so far):");
  for (const nodeId of tree.dfsOrder) {
    const content = context.nodeContents[nodeId];
    if (!content) continue;
    line(`[${tree.outlineMap.get(nodeId)}] QUESTION: `, content.query);
    if (content.parentSelectedText) line('    ASKED ABOUT: "', content.parentSelectedText, '"');
    if (context.readNodeIds.has(nodeId) && content.response) {
      line('    ANSWER: ', content.response);
    }
    if (content.documents.length > 0) documentLines(content.documents);
  }

  // On submit the draft joins the tree as a new open question carrying the
  // staged documents, and repeats in the CURRENT QUESTION footer below.
  line('QUESTION: ', context.draftQuery);
  if (context.draftDocuments.length > 0) documentLines(context.draftDocuments);
  line('');

  let readOrderChars = 0;
  for (const nodeId of context.readNodeIds) {
    const outline = tree.outlineMap.get(nodeId);
    if (outline) readOrderChars += outline.length + 4; // "[1.2], "
  }
  if (readOrderChars > 0) {
    line('READ ORDER: ');
    chars += readOrderChars;
    line('');
  }

  line('CURRENT QUESTION: ', context.draftQuery);
  line('');

  return Math.round(chars / CHARS_PER_TOKEN);
}
