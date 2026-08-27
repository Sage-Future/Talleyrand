import { client } from '../client';
import type { DeclineReason, Document } from '../types';

export interface KickstartQuestion {
  text: string;
  fromUser: boolean;
}

// A kickoff question the user declined, with the reason when they gave one
export interface KickstartDeclinedQuestion {
  text: string;
  reason: DeclineReason | null;
}

interface KickstartListState {
  approved: string[];
  pending: string[];
  declined: KickstartDeclinedQuestion[];
}

function errorDetail(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'detail' in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
  }
  return fallback;
}

/**
 * The two kickstart calls behind the "Generate questions" modal. Both throw on
 * failure — the modal renders the error per section with a retry affordance.
 */
class ResearchKickstartService {
  async generateBrief(inputText: string, documents: Document[]): Promise<string> {
    const { data, error } = await client.POST('/research/kickstart/brief', {
      body: { inputText, documents },
    });
    if (error || !data) {
      throw new Error(errorDetail(error, 'The brief could not be generated.'));
    }
    return data.brief;
  }

  async generateQuestions(
    inputText: string,
    documents: Document[],
    brief: string,
    listState: KickstartListState,
    requestMore: boolean
  ): Promise<KickstartQuestion[]> {
    const { data, error } = await client.POST('/research/kickstart/questions', {
      body: { inputText, documents, brief, ...listState, requestMore },
    });
    if (error || !data) {
      throw new Error(errorDetail(error, 'Questions could not be generated.'));
    }
    return data.questions;
  }
}

export const researchKickstartService = new ResearchKickstartService();
