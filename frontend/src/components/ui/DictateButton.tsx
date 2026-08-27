import { FC, useEffect, useRef } from 'react';
import { useDictation } from '../../hooks/useDictation';

const MicIcon: FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 15.75a3 3 0 003-3V4.5a3 3 0 10-6 0v8.25a3 3 0 003 3zM18 12.75v-1.5m0 1.5a6 6 0 01-12 0v-1.5m6 7.5v3.75m-3.75 0h7.5"
    />
  </svg>
);

const StopIcon: FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const SpinnerIcon: FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
    />
  </svg>
);

const RetryIcon: FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
    />
  </svg>
);

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

interface DictateButtonProps {
  /** Receives transcribed text when a recording finishes. */
  onTranscript: (text: string) => void;
  /** Notified when the dictation error changes (null clears it). */
  onError?: (message: string | null) => void;
  /** Prevents starting a recording; stopping one already in progress stays allowed. */
  disabled?: boolean;
  testId?: string;
}

/**
 * Microphone button that records speech and hands back the transcript via
 * `onTranscript`. Renders nothing when the browser can't record. Cycles
 * Dictate → Recording… → Transcribing…; while recording it shows how long is
 * left before the auto-stop limit and stays clickable so the user can stop
 * even if `disabled` flips true. When a transcription fails, a Retry button
 * appears alongside so the kept recording can be re-sent.
 */
export const DictateButton: FC<DictateButtonProps> = ({
  onTranscript,
  onError,
  disabled = false,
  testId,
}) => {
  const dictation = useDictation({ onTranscript });

  // Forward error changes to the parent without depending on a stable callback.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    onErrorRef.current?.(dictation.error);
  }, [dictation.error]);

  if (!dictation.isSupported) return null;

  return (
    <>
      <button
        onClick={dictation.toggle}
        disabled={(disabled && dictation.status === 'idle') || dictation.status === 'transcribing'}
        className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors disabled:opacity-60 ${
          dictation.status === 'recording'
            ? 'font-medium text-red-600 hover:bg-red-50'
            : 'text-stone-400 hover:bg-stone-100 hover:text-stone-800'
        }`}
        data-tooltip={dictation.status === 'recording' ? 'Stop recording' : 'Dictate your thoughts'}
        data-testid={testId}
      >
        {dictation.status === 'transcribing' ? (
          <>
            <SpinnerIcon className="h-3.5 w-3.5" />
            Transcribing…
          </>
        ) : dictation.status === 'recording' ? (
          <>
            <StopIcon className="h-3.5 w-3.5 animate-pulse" />
            Recording…
            {dictation.remainingSeconds !== null &&
              ` ${formatClock(dictation.remainingSeconds)} left`}
          </>
        ) : (
          <>
            <MicIcon className="h-3.5 w-3.5" />
            Dictate
          </>
        )}
      </button>
      {dictation.canRetry && dictation.status === 'idle' && (
        <button
          onClick={dictation.retry}
          disabled={disabled}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
          data-tooltip="Retry transcribing the last recording"
          data-testid={testId ? `${testId}-retry` : undefined}
        >
          <RetryIcon className="h-3.5 w-3.5" />
          Retry
        </button>
      )}
    </>
  );
};
