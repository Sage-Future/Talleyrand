import { client } from '../client';
import { BACKEND_CONFIG } from '../config/constants';
import type { DeclinedQuestion, Document, Edge, NodeContent, ResearchSuggestion } from '../types';
import type { GraphNode } from '../stores/graphStructureStore';

export interface SharedGraphData {
  name: string;
  nodes: GraphNode[];
  edges: Edge[];
  nodeContents: NodeContent[];
  brief: string;
  caseDocuments: Document[];
  suggestions: ResearchSuggestion[];
  declinedQuestions: DeclinedQuestion[];
}

export async function shareGraph(graphId: string): Promise<boolean> {
  const { data, error } = await client.POST('/share/graph/{graph_id}', {
    params: { path: { graph_id: graphId } },
  });

  if (error) {
    console.error('Failed to share graph:', error);
    throw new Error('Failed to share graph');
  }

  return (data as { isShared: boolean }).isShared;
}

export async function revokeShare(graphId: string): Promise<void> {
  const { error } = await client.DELETE('/share/graph/{graph_id}', {
    params: { path: { graph_id: graphId } },
  });

  if (error) {
    console.error('Failed to revoke share:', error);
    throw new Error('Failed to revoke share');
  }
}

export async function fetchSharedGraph(graphId: string): Promise<SharedGraphData> {
  const response = await fetch(`${BACKEND_CONFIG.BACKEND_HTTP_URL}/share/${graphId}`);

  if (!response.ok) {
    throw new Error(response.status === 404 ? 'Graph not found' : 'Failed to load shared graph');
  }

  return response.json();
}

export async function copySharedGraph(graphId: string): Promise<string> {
  const { data, error } = await client.POST('/share/{graph_id}/copy', {
    params: { path: { graph_id: graphId } },
  });

  if (error) {
    console.error('Failed to copy graph:', error);
    throw new Error('Failed to copy graph');
  }

  return (data as { id: string }).id;
}
