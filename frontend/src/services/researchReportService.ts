import { client } from '../client';
import { useGraphStructureStore } from '../stores/graphStructureStore';
import { toGraphPayload } from '../utils/graphPayload';

function errorDetail(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'detail' in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
  }
  return fallback;
}

/**
 * Generates a Markdown report of the whole case. The live graph ships
 * in the body (like the transient suggester), so the report reflects exactly
 * what is on screen — brief, answers, read order, highlights, declines. Optional
 * guidance lets the user steer what the report focuses on. Throws on failure;
 * the modal renders the message with a retry affordance.
 */
class ResearchReportService {
  async generateReport(guidance: string): Promise<string> {
    const graph = useGraphStructureStore.getState().getGraph();
    const { data, error } = await client.POST('/research/report', {
      body: { graph: toGraphPayload(graph), guidance: guidance.trim() },
    });
    if (error || !data) {
      throw new Error(errorDetail(error, 'The report could not be generated.'));
    }
    return data.markdown;
  }
}

export const researchReportService = new ResearchReportService();
