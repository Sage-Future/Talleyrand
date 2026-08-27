/**
 * Shared AST utilities for markdown processing.
 */

import type { BlockKind } from './types';

/**
 * Determines if a node is a content block (contains inline elements/text).
 *
 * We track listItem separately because ReactMarkdown doesn't always wrap
 * list item text in <p> tags, so we can't rely on child paragraphs getting IDs.
 *
 * Note: listItem is treated as a leaf block here - callers should SKIP
 * children of listItems to avoid duplication with nested paragraphs.
 */
export function getBlockKind(node: any): BlockKind | null {
  switch (node.type) {
    case 'paragraph':
      return 'paragraph';
    case 'heading':
      return 'heading';
    case 'code':
      return 'code_block';
    case 'tableCell':
      return 'table_cell';
    case 'listItem':
      return 'list_item';
    default:
      return null;
  }
}

/**
 * Extracts plain text from an AST node, stripping formatting.
 * Preserves line breaks to match how ReactMarkdown renders the text.
 */
export function extractPlainText(node: any): string {
  if (node.type === 'text') {
    return node.value;
  }

  if (node.type === 'inlineCode') {
    return node.value;
  }

  if (node.type === 'inlineMath' || node.type === 'math') {
    return node.value;
  }

  // Handle code blocks (have value property directly)
  if (node.type === 'code') {
    return node.value;
  }

  // Handle hard line breaks (two spaces + newline in markdown, or explicit <br>)
  if (node.type === 'break') {
    return '\n';
  }

  if (node.children && Array.isArray(node.children)) {
    return node.children.map(extractPlainText).join('');
  }

  return '';
}
