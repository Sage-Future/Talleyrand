import { client } from '../client';
import type { ModelType } from '../config/models';
import type { Document } from '../types';

export interface ContextSize {
  tokens: number;
  maxInputTokens: number;
  // tiktoken stood in for Anthropic's counter (no Anthropic key on this
  // device, or the count failed); the real request may count differently.
  estimated: boolean;
}

/**
 * Counts the prompt the next question would send, by the tokenizer that will
 * judge it (see the backend's context_size.py). The backend reads the saved
 * case, so what is not saved yet — the parent the draft would be filed under
 * and the documents staged on it — travels in the request. PDFs are attached
 * to requests rather than inlined, so their content is not needed for the count.
 *
 * Resolves undefined when the case is not on the server yet or the count fails.
 */
export async function countNextQuestionContext(
  input: {
    graphId: string;
    model: ModelType;
    parentNodeId: string | null;
    draftDocuments: Document[];
  },
  signal?: AbortSignal
): Promise<ContextSize | undefined> {
  try {
    const { data, error } = await client.POST('/research/{graph_id}/context-size', {
      params: { path: { graph_id: input.graphId } },
      body: {
        model: input.model,
        parentNodeId: input.parentNodeId,
        // The draft text changes with every keystroke and is estimated locally
        draftQuery: '',
        draftDocuments: input.draftDocuments.map(document =>
          document.type === 'pdf' ? { ...document, content: '' } : document
        ),
      },
      signal,
    });
    if (error || !data) return undefined;
    return data;
  } catch (err) {
    if (signal?.aborted) return undefined;
    console.error('Failed to count the context for the next question:', err);
    return undefined;
  }
}
