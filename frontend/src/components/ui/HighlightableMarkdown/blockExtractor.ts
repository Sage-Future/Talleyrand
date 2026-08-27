/**
 * Block extraction logic for markdown content.
 *
 * This implementation extracts blocks from rendered HTML rather than the markdown AST.
 * This ensures the text matches exactly what will be displayed, guaranteeing correct
 * character offsets for annotations.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { fromHtml } from 'hast-util-from-html';
import { toString as hastToString } from 'hast-util-to-string';
import { visit } from 'unist-util-visit';
import type { Element } from 'hast';
import type { Block, BlockKind } from './types';
import { remarkAddBlockIds } from './remarkAddBlockIds';

/**
 * Extracts blocks from markdown by rendering to HTML first.
 * This ensures the text matches exactly what will be displayed in the UI.
 *
 * Why HTML-based extraction?
 * - Guarantees text matches what rehypeHighlight processes
 * - Handles all edge cases automatically (nested lists, code blocks, etc.)
 * - Future-proof against new markdown features
 * - Single source of truth for text content
 */
export function extractBlocks(markdown: string): Block[] {
  // Step 1: Render markdown to HTML with block IDs (same pipeline as UI rendering)
  const htmlString = unified()
    .use(remarkParse)
    .use(remarkMath)
    .use(remarkGfm)
    .use(remarkAddBlockIds) // Adds data-block-id attributes
    .use(remarkRehype)
    .use(rehypeStringify)
    .processSync(markdown)
    .toString();

  // Step 2: Parse HTML back to HAST (HTML AST)
  const hast = fromHtml(htmlString, { fragment: true });

  // Step 3: Extract text from each block element
  const blocks: Block[] = [];

  visit(hast, 'element', (node: Element) => {
    if (node.properties?.dataBlockId) {
      const blockId = String(node.properties.dataBlockId);

      // Extract text exactly as it appears in HTML
      // hastToString uses the same text extraction logic as browsers
      const text = hastToString(node);

      const kind = inferBlockKind(node.tagName);

      if (text.trim().length > 0) {
        blocks.push({ blockId, kind, text });
      }
    }
  });

  return blocks;
}

/**
 * Infers block kind from HTML tag name.
 * Maps HTML elements back to our BlockKind types.
 */
function inferBlockKind(tagName: string): BlockKind {
  switch (tagName) {
    case 'p':
      return 'paragraph';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'li':
      return 'list_item';
    case 'td':
    case 'th':
      return 'table_cell';
    case 'pre':
    case 'code':
      return 'code_block';
    default:
      return 'paragraph';
  }
}
