/**
 * Rehype plugin that turns question-reference tokens in text nodes into
 * <questionRef> elements, rendered by the QuestionRef chip component.
 *
 * Two token forms exist. Stored answers carry node-id tokens ([[<uuid>]]),
 * stable across tree edits. Outline-number tokens ([[1.2]]) are what the
 * model writes and are only ever rendered mid-stream, before the completed
 * answer is persisted with its refs frozen to node ids.
 *
 * The literal token is kept as the element's child text: block extraction
 * (which never runs this plugin) sees the token as plain text, so keeping it
 * in the HAST keeps rehypeHighlight's character counting aligned with the
 * block-text coordinate system used for selection offsets.
 */

import { visit } from 'unist-util-visit';
import type { Root as HastRoot, Element, ElementContent } from 'hast';

const QUESTION_REF_PATTERN =
  /\[\[(?:(\d+(?:\.\d+)*)|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))\]\]/g;

// Text inside these stays literal: code is verbatim by definition, and a chip
// nested in a link would put a button inside an anchor.
const SKIPPED_PARENTS = new Set(['code', 'pre', 'a']);

export function rehypeQuestionRefs() {
  return (tree: HastRoot) => {
    visit(tree, 'text', (node, index, parent) => {
      if (index === undefined || parent === undefined) return;
      if (parent.type === 'element' && SKIPPED_PARENTS.has(parent.tagName)) return;
      if (!node.value.includes('[[')) return;

      const matches = [...node.value.matchAll(QUESTION_REF_PATTERN)];
      if (matches.length === 0) return;

      const parts: ElementContent[] = [];
      let cursor = 0;
      for (const match of matches) {
        if (match.index > cursor) {
          parts.push({ type: 'text', value: node.value.slice(cursor, match.index) });
        }
        parts.push({
          type: 'element',
          tagName: 'questionRef',
          properties: match[1] ? { refOutline: match[1] } : { refNodeId: match[2] },
          children: [{ type: 'text', value: match[0] }],
        } as Element);
        cursor = match.index + match[0].length;
      }
      if (cursor < node.value.length) {
        parts.push({ type: 'text', value: node.value.slice(cursor) });
      }

      parent.children.splice(index, 1, ...parts);
      // Continue after the inserted nodes so their child text isn't re-visited
      return index + parts.length;
    });
  };
}
