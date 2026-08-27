import { FC, useLayoutEffect, useRef, useState } from 'react';
import {
  DEFAULT_MODEL,
  MODELS,
  isRetiredModel,
  modelLabel,
  resolveModelId,
} from '../../config/models';
import { researchGenerationService } from '../../services/researchGenerationService';
import { useNodeContentStore } from '../../stores/nodeContentStore';
import { ModelPicker } from '../ui/ModelPicker';
import type { ModelType } from '../../types';

/**
 * Action under a completed answer: discard it and answer the question again
 * with a model picked in the popover. Opens with the model that produced the
 * current answer; fresh follow-up suggestions arrive once the new answer lands.
 */
export const RegenerateButton: FC<{ nodeId: string }> = ({ nodeId }) => {
  const answeredBy = useNodeContentStore(s => s.nodeContents[nodeId]?.selectedModel);
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<ModelType>(() => resolveModelId(answeredBy));
  const wrapperRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const selected = MODELS.find(m => m.id === model) ?? MODELS[0];
  // The trigger names the model that produced the current answer — not the
  // (possibly unconfirmed) picker selection — so closing without regenerating
  // leaves the real label in place. An answer written by a since-retired model
  // keeps that model's name here; only regenerating moves it to a current one.
  const answeredLabel = modelLabel(answeredBy ?? DEFAULT_MODEL);
  const answeredByRetired = isRetiredModel(answeredBy);

  const toggleOpen = () => {
    if (!open) {
      setModel(resolveModelId(answeredBy));
    }
    setOpen(!open);
  };

  const confirm = () => {
    setOpen(false);
    void researchGenerationService.regenerate(nodeId, model);
  };

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        onClick={toggleOpen}
        className="flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-medium text-stone-500 shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-800"
        data-tooltip="Re-answer this question with another model"
      >
        <svg
          className="h-3 w-3 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        {answeredLabel}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1.5 w-64 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-xl">
          <div className="border-b border-stone-100 bg-stone-50 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-stone-400">
            Regenerate with
          </div>
          <div className="px-3 py-2.5">
            <ModelPicker selectedModel={model} onModelChange={setModel} />
            <div className="mt-2 text-[10px] text-stone-400">{selected.description}</div>
            {answeredByRetired && (
              <div className="mt-2 text-[10px] leading-relaxed text-amber-700">
                {answeredLabel} has been retired. Regenerating uses {selected.label}.
              </div>
            )}
            <button
              onClick={confirm}
              className="mt-2.5 w-full rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-stone-50 transition-colors hover:bg-stone-700"
            >
              Regenerate with {selected.label}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
