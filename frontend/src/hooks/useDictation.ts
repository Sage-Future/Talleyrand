import { useCallback, useEffect, useRef, useState } from 'react';
import { transcriptionService } from '../services/transcriptionService';

type DictationStatus = 'idle' | 'recording' | 'transcribing';

// MediaRecorder output formats the transcription model accepts, best first.
// The browser picks the first one it supports; Chrome/Firefox land on webm,
// Safari on mp4.
const PREFERRED_MIME_TYPES = ['audio/webm', 'audio/mp4', 'audio/ogg'];

// The clip travels base64-encoded (+33%) in a JSON body the backend caps at
// 20 MB, and OpenAI caps transcription uploads at 25 MB. Twenty minutes at the
// 64 kbps we request (transparent for speech) is ~10 MB raw, safely under both.
const MAX_RECORDING_SECONDS = 1200;
const AUDIO_BITS_PER_SECOND = 64_000;

const LIMIT_REACHED_MESSAGE = `Recording stopped at the ${MAX_RECORDING_SECONDS / 60}-minute limit.`;

function pickMimeType(): string | undefined {
  return PREFERRED_MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // readAsDataURL yields "data:<mime>;base64,<data>"; send only the data.
      const result = reader.result as string;
      const comma = result.indexOf(',');
      if (comma < 0) {
        reject(new Error('Could not read the recording.'));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the recording.'));
    reader.readAsDataURL(blob);
  });
}

function microphoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Microphone access was blocked. Allow it in your browser to dictate.';
    }
    if (error.name === 'NotFoundError') {
      return 'No microphone was found.';
    }
  }
  return error instanceof Error ? error.message : 'Could not start recording.';
}

interface UseDictationOptions {
  /** Called with the transcribed text once a recording finishes. */
  onTranscript: (text: string) => void;
}

interface UseDictation {
  status: DictationStatus;
  error: string | null;
  /** True when the browser can record and transcribe audio. */
  isSupported: boolean;
  /** Seconds left before the recording auto-stops; null when not recording. */
  remainingSeconds: number | null;
  /** True when the last recording failed to transcribe and can be retried. */
  canRetry: boolean;
  /** Start recording when idle, stop and transcribe when recording. */
  toggle: () => void;
  /** Re-send the kept recording after a failed transcription. */
  retry: () => void;
}

/**
 * Records the microphone with MediaRecorder, then sends the clip to the backend
 * for speech-to-text. The whole flow is event-driven: stopping the recorder
 * fires `onstop`, which assembles the clip, releases the mic, and transcribes.
 * Recordings auto-stop at MAX_RECORDING_SECONDS (a countdown is exposed), and a
 * clip whose transcription failed is kept so the user can retry instead of
 * losing what they said.
 */
export function useDictation({ onTranscript }: UseDictationOptions): UseDictation {
  const [status, setStatus] = useState<DictationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  // The clip of the last failed transcription, kept for retry.
  const [failedClip, setFailedClip] = useState<Blob | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const startingRef = useRef(false);
  // Stays false after unmount so an in-flight transcription doesn't update state.
  const mountedRef = useRef(true);

  // Keep the latest callback so the recorder's onstop handler stays current
  // without re-creating the recorder.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const isSupported =
    typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const transcribeClip = useCallback(async (clip: Blob) => {
    setStatus('transcribing');
    try {
      const audio = await blobToBase64(clip);
      const text = await transcriptionService.transcribe(audio, clip.type);
      // The modal may have closed mid-transcription — drop the result.
      if (mountedRef.current) {
        setFailedClip(null);
        onTranscriptRef.current(text);
      }
    } catch (err) {
      if (mountedRef.current) {
        setFailedClip(clip);
        setError(err instanceof Error ? err.message : 'The recording could not be transcribed.');
      }
    } finally {
      if (mountedRef.current) setStatus('idle');
    }
  }, []);

  const start = useCallback(async () => {
    // Guard against a double-click spawning a second recorder before
    // getUserMedia resolves (which would leak the first stream).
    if (startingRef.current || recorderRef.current) return;
    startingRef.current = true;
    setError(null);
    // Recording anew is an explicit choice to drop the failed clip.
    setFailedClip(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // The component may have unmounted while the permission prompt was open;
      // its cleanup has already run, so release this stream here to free the mic.
      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : undefined),
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
      chunksRef.current = [];

      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        clearTimer();
        setRemainingSeconds(null);
        releaseStream();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];
        recorderRef.current = null;

        if (blob.size === 0) {
          if (mountedRef.current) setStatus('idle');
          return;
        }
        void transcribeClip(blob);
      };

      recorderRef.current = recorder;
      recorder.start();

      // Auto-stop at the limit so the clip never outgrows what transcription
      // accepts. Computed from a start timestamp rather than counted ticks so
      // a throttled interval can't let the recording run long.
      const startedAt = Date.now();
      setRemainingSeconds(MAX_RECORDING_SECONDS);
      timerRef.current = window.setInterval(() => {
        const remaining = MAX_RECORDING_SECONDS - Math.floor((Date.now() - startedAt) / 1000);
        if (remaining <= 0) {
          setError(LIMIT_REACHED_MESSAGE);
          if (recorder.state !== 'inactive') recorder.stop();
        } else {
          setRemainingSeconds(remaining);
        }
      }, 250);

      setStatus('recording');
    } catch (err) {
      releaseStream();
      recorderRef.current = null;
      setError(microphoneError(err));
      setStatus('idle');
    } finally {
      startingRef.current = false;
    }
  }, [releaseStream, clearTimer, transcribeClip]);

  const toggle = useCallback(() => {
    if (status === 'recording') {
      recorderRef.current?.stop();
    } else if (status === 'idle') {
      void start();
    }
    // While transcribing, ignore toggles.
  }, [status, start]);

  const retry = useCallback(() => {
    if (!failedClip || status !== 'idle') return;
    setError(null);
    void transcribeClip(failedClip);
  }, [failedClip, status, transcribeClip]);

  // On unmount (e.g. the modal closes mid-recording), detach the recorder's
  // handlers so no stray transcription runs, then stop everything and release
  // the microphone.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
        recorderRef.current = null;
      }
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, [clearTimer]);

  return {
    status,
    error,
    isSupported,
    remainingSeconds,
    canRetry: failedClip !== null,
    toggle,
    retry,
  };
}
