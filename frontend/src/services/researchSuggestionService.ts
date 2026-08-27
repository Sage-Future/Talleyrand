import { client } from '../client';
import { useGraphStructureStore } from '../stores/graphStructureStore';
import { useResearchStore } from '../stores/researchStore';
import { saveNow } from './autosaveSubscriptions';

/**
 * Starts server-owned suggestion jobs. Results are persisted server-side and
 * arrive through the generation job stream (researchGenerationService), so
 * suggestions survive the browser closing mid-generation. A failure logs and
 * does nothing — "suggest more" is the manual recovery; no retries.
 *
 * Each started job is registered in researchStore (jobId -> node, null for
 * big-picture) so the UI can show a "generating…" indicator; the generation
 * service clears it when the batch (or its error) lands.
 */
class ResearchSuggestionService {
  async fetchSuggestions(nodeId: string, requestMore: boolean): Promise<void> {
    const graphId = useGraphStructureStore.getState().id;

    try {
      // The suggester reads the saved doc; the read event that triggered this
      // call must be in it for the just-read answer to enter the context.
      await saveNow();
      const { data, error } = await client.POST(
        '/research/{graph_id}/node/{node_id}/suggest-followups',
        {
          params: { path: { graph_id: graphId, node_id: nodeId } },
          body: { requestMore },
        }
      );
      if (error) {
        console.error('Failed to start suggestion generation:', error);
        return;
      }
      if (data) useResearchStore.getState().addSuggestionJob(data.id, nodeId);
    } catch (err) {
      console.error('Failed to start suggestion generation:', err);
    }
  }

  /**
   * Big-picture pass over the whole case: each generated question
   * arrives placed under the tree node it should be filed under.
   */
  async fetchBigPictureSuggestions(): Promise<void> {
    const graphId = useGraphStructureStore.getState().id;

    try {
      await saveNow();
      const { data, error } = await client.POST('/research/{graph_id}/suggest-big-picture', {
        params: { path: { graph_id: graphId } },
      });
      if (error) {
        console.error('Failed to start big-picture suggestion generation:', error);
        return;
      }
      if (data) useResearchStore.getState().addSuggestionJob(data.id, null);
    } catch (err) {
      console.error('Failed to start big-picture suggestion generation:', err);
    }
  }
}

export const researchSuggestionService = new ResearchSuggestionService();
