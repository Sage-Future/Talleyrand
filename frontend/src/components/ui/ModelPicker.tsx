import { FC, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MODELS,
  PROVIDER_LABELS,
  PROVIDERS,
  type ModelProvider,
  type ModelType,
} from '../../config/models';

// Must match the thumb size in .thinking-slider (w-3.5) so tooltip and tick dots
// align with the thumb's travel range.
const THUMB_WIDTH_PX = 14;

interface ModelPickerProps {
  selectedModel: ModelType;
  onModelChange: (model: ModelType) => void;
  disabled?: boolean;
  allowedModels?: ModelType[];
}

/**
 * Compact model picker: a provider toggle (GPT / Claude) plus a thinking
 * slider that walks the provider's ladder from fastest model to deepest
 * reasoning. The model name shows in a tooltip while hovering or dragging.
 */
export const ModelPicker: FC<ModelPickerProps> = ({
  selectedModel,
  onModelChange,
  disabled = false,
  allowedModels,
}) => {
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null);
  const sliderRef = useRef<HTMLInputElement>(null);

  const allowed = allowedModels ? MODELS.filter(m => allowedModels.includes(m.id)) : [...MODELS];
  const availableProviders = PROVIDERS.filter(p => allowed.some(m => m.provider === p));

  const provider: ModelProvider =
    MODELS.find(m => m.id === selectedModel)?.provider ?? availableProviders[0];
  const ladder = allowed.filter(m => m.provider === provider);
  const steps = ladder.length;
  const sliderIndex =
    steps > 0
      ? Math.max(
          ladder.findIndex(m => m.id === selectedModel),
          0
        )
      : 0;
  const sliderModel = ladder[sliderIndex];
  const sliderFraction = steps > 1 ? sliderIndex / (steps - 1) : 0.5;
  const showTooltip = (hovering || dragging) && !disabled && steps > 0;

  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, [dragging]);

  // Auto-correct model if it's not in the allowed list
  useEffect(() => {
    if (allowedModels && !allowedModels.includes(selectedModel) && allowed.length > 0) {
      onModelChange(allowed[0].id);
    }
  }, [allowedModels, selectedModel, allowed, onModelChange]);

  // The tooltip renders in a portal with fixed positioning so it is never
  // clipped by overflow-hidden popovers, modals, or scroll containers.
  useLayoutEffect(() => {
    if (!showTooltip || !sliderRef.current) {
      setTooltipPos(null);
      return;
    }
    const slider = sliderRef.current;
    const rect = slider.getBoundingClientRect();
    // Inside the zoomed canvas the rect is scaled — scale the thumb width too
    const scale = slider.offsetWidth > 0 ? rect.width / slider.offsetWidth : 1;
    const thumbWidth = THUMB_WIDTH_PX * scale;
    setTooltipPos({
      left: rect.left + thumbWidth / 2 + sliderFraction * (rect.width - thumbWidth),
      top: rect.top - 6,
    });
  }, [showTooltip, sliderFraction]);

  if (ladder.length === 0) {
    return null; // selected model not allowed — the auto-correct effect re-renders
  }

  const switchProvider = (target: ModelProvider) => {
    if (target === provider) return;
    const targetLadder = allowed.filter(m => m.provider === target);
    // Keep the thinking position when jumping between providers
    const targetIndex = Math.min(sliderIndex, targetLadder.length - 1);
    onModelChange(targetLadder[targetIndex].id);
  };

  // The thumb center travels [THUMB/2, width - THUMB/2], not the full width
  const thumbCenter = (fraction: number) =>
    `calc(${fraction * 100}% + ${(0.5 - fraction) * THUMB_WIDTH_PX}px)`;

  return (
    <div className="flex items-center gap-2">
      <div className="flex overflow-hidden rounded-md border border-stone-300 bg-white shadow-sm">
        {availableProviders.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => switchProvider(p)}
            disabled={disabled}
            data-tooltip={`Use ${PROVIDER_LABELS[p]} models`}
            className={`px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed ${
              p === provider
                ? 'bg-stone-800 text-stone-50'
                : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800'
            }`}
          >
            {PROVIDER_LABELS[p]}
          </button>
        ))}
      </div>
      <div
        className="relative flex w-32 items-center py-1"
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => setHovering(false)}
      >
        {showTooltip &&
          tooltipPos &&
          createPortal(
            <div
              className="pointer-events-none fixed z-[100] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-stone-800 px-2 py-0.5 text-[10px] text-stone-50 shadow-lg"
              style={{ left: tooltipPos.left, top: tooltipPos.top }}
            >
              {sliderModel.label}
            </div>,
            document.body
          )}
        <div className="pointer-events-none absolute inset-0">
          {ladder.map((m, i) => (
            <span
              key={m.id}
              className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-stone-300"
              style={{ left: thumbCenter(steps > 1 ? i / (steps - 1) : 0.5) }}
            />
          ))}
        </div>
        <input
          ref={sliderRef}
          type="range"
          min={0}
          max={steps - 1}
          step={1}
          value={sliderIndex}
          disabled={disabled || steps <= 1}
          onChange={e => onModelChange(ladder[Number(e.target.value)].id)}
          onPointerDown={() => setDragging(true)}
          className="thinking-slider relative"
          aria-label="Thinking depth — left is faster, right reasons deeper"
        />
      </div>
    </div>
  );
};
