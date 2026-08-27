import { client } from '../client';

function errorDetail(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'detail' in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
  }
  return fallback;
}

/**
 * Sends a recorded audio clip to the backend for speech-to-text. Throws on
 * failure so callers can surface the error inline.
 */
class TranscriptionService {
  /** @param audio base64-encoded audio bytes (no data-URL prefix). */
  async transcribe(audio: string, mimeType: string): Promise<string> {
    const { data, error } = await client.POST('/transcription/transcribe', {
      body: { audio, mimeType },
    });
    if (error || !data) {
      throw new Error(errorDetail(error, 'The recording could not be transcribed.'));
    }
    return data.text;
  }
}

export const transcriptionService = new TranscriptionService();
