/**
 * Remark plugin to add block IDs to AST nodes.
 */

import { visit, SKIP } from 'unist-util-visit';
import type { Root as MdastRoot } from 'mdast';
import { getBlockKind, extractPlainText } from './astUtils';

/**
 * Remark plugin that adds block IDs to nodes based on traversal order.
 * This matches the same traversal order used in blockExtractor.
 */
export function remarkAddBlockIds() {
  return (tree: MdastRoot) => {
    let blockIdCounter = 0;

    // Walk the AST in the same order as blockExtractor
    visit(tree, node => {
      const kind = getBlockKind(node);
      if (kind) {
        const text = extractPlainText(node);
        if (text.trim().length > 0) {
          const blockId = `b${blockIdCounter++}`;

          // Add data property to carry through to HAST
          if (!node.data) {
            node.data = {};
          }
          node.data.hProperties = {
            ...((node.data.hProperties as any) || {}),
            dataBlockId: blockId,
          };

          // Skip children of listItems to match blockExtractor behavior
          if (kind === 'list_item') {
            return SKIP;
          }
        }
      }
    });
  };
}
