import { client } from '../client';
import type { GraphData } from '../types';
import { toGraphPayload } from '../utils/graphPayload';

interface QuestionSuggestionResult {
  questions: string[];
}

class QuestionSuggestionService {
  async generateSuggestions(
    graph: GraphData,
    nodeId: string,
    selectedText?: string,
    selectedPrefix?: string,
    selectedSuffix?: string,
    signal?: AbortSignal
  ): Promise<QuestionSuggestionResult> {
    const { data, error } = await client.POST('/research/{graph_id}/node/{node_id}/suggest', {
      params: {
        path: {
          graph_id: graph.id,
          node_id: nodeId,
        },
      },
      body: {
        graph: toGraphPayload(graph),
        selection: selectedText
          ? { text: selectedText, prefix: selectedPrefix, suffix: selectedSuffix }
          : null,
      },
      signal,
    });

    if (error) {
      console.error('Error generating question suggestions:', error);
      return { questions: [] };
    }

    return { questions: data.questions };
  }
}

export const questionSuggestionService = new QuestionSuggestionService();
