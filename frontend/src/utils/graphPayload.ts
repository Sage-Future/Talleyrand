import type { GraphData } from '../types';

/**
 * GraphNoId-shaped request payload for endpoints that take the graph in the body.
 */
export function toGraphPayload(graph: Omit<GraphData, 'id' | 'name' | 'revision'>) {
  return {
    nodes: graph.nodes,
    edges: graph.edges,
    nodeContents: graph.nodeContents,
    brief: graph.brief,
    caseDocuments: graph.caseDocuments,
    suggestions: graph.suggestions,
    declinedQuestions: graph.declinedQuestions,
    readHistory: graph.readHistory,
  };
}
