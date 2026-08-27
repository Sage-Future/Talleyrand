/**
 * Question-tree projection of the graph for the research view.
 *
 * Mirrors the backend projection (features/research/context_builder.py): children
 * ordered by creation order (index in the nodes array), first parent wins for
 * legacy multi-parent nodes, cycles from legacy graphs are cut.
 */

import type { Edge } from '../types';
import type { GraphNode } from '../stores/graphStructureStore';

export interface QuestionTree {
  rootIds: string[];
  childrenMap: Map<string, string[]>;
  parentMap: Map<string, string | null>;
  outlineMap: Map<string, string>; // nodeId -> "1.2"
  dfsOrder: string[];
}

export function buildQuestionTree(nodes: GraphNode[], edges: Edge[]): QuestionTree {
  const chatIds = nodes.map(node => node.id);
  const chatSet = new Set(chatIds);

  const parentMap = new Map<string, string | null>(chatIds.map(id => [id, null]));
  for (const edge of edges) {
    if (
      chatSet.has(edge.target) &&
      chatSet.has(edge.source) &&
      edge.source !== edge.target &&
      parentMap.get(edge.target) === null
    ) {
      parentMap.set(edge.target, edge.source);
    }
  }

  // Break parent cycles from legacy multi-edge graphs: walk each chain up;
  // on revisiting a node within the current chain, cut its parent link.
  const resolved = new Set<string>();
  for (const nodeId of chatIds) {
    const chain: string[] = [];
    const chainSet = new Set<string>();
    let current: string | null = nodeId;
    while (current !== null && !resolved.has(current)) {
      if (chainSet.has(current)) {
        parentMap.set(current, null);
        break;
      }
      chain.push(current);
      chainSet.add(current);
      current = parentMap.get(current) ?? null;
    }
    chain.forEach(id => resolved.add(id));
  }

  const rootIds: string[] = [];
  const childrenMap = new Map<string, string[]>(chatIds.map(id => [id, []]));
  for (const nodeId of chatIds) {
    const parentId = parentMap.get(nodeId) ?? null;
    if (parentId === null) {
      rootIds.push(nodeId);
    } else {
      childrenMap.get(parentId)!.push(nodeId);
    }
  }

  const outlineMap = new Map<string, string>();
  const dfsOrder: string[] = [];
  const assignOutline = (nodeId: string, prefix: string) => {
    outlineMap.set(nodeId, prefix);
    dfsOrder.push(nodeId);
    childrenMap.get(nodeId)!.forEach((childId, index) => {
      assignOutline(childId, `${prefix}.${index + 1}`);
    });
  };
  rootIds.forEach((rootId, index) => assignOutline(rootId, `${index + 1}`));

  return { rootIds, childrenMap, parentMap, outlineMap, dfsOrder };
}

/** Ancestor ids from root down to the direct parent of the given node. */
export function ancestorsOf(tree: QuestionTree, nodeId: string): string[] {
  const ancestors: string[] = [];
  let current = tree.parentMap.get(nodeId) ?? null;
  while (current !== null) {
    ancestors.push(current);
    current = tree.parentMap.get(current) ?? null;
  }
  return ancestors.reverse();
}

/** All descendant ids of the given node, in DFS order. */
export function descendantsOf(tree: QuestionTree, nodeId: string): string[] {
  const result: string[] = [];
  const walk = (id: string) => {
    for (const childId of tree.childrenMap.get(id) ?? []) {
      result.push(childId);
      walk(childId);
    }
  };
  walk(nodeId);
  return result;
}
