import { FC, useEffect } from 'react';
import { MODELS, PROVIDER_LABELS, PROVIDERS, type ModelType } from '../../config/models';

interface ModelPickerProps {
  selectedModel: ModelType;
  onModelChange: (model: ModelType) => void;
  disabled?: boolean;
  allowedModels?: ModelType[];
}

/**
 * Compact model picker: a provider toggle (Claude Code / Hermes) plus a
 * dropdown of the models that agent can run.
 */
export const ModelPicker: FC<ModelPickerProps> = ({
  selectedModel,
  onModelChange,
  disabled = false,
  allowedModels,
}) => {
  const allowed = allowedModels ? MODELS.filter(m => allowedModels.includes(m.id)) : [...MODELS];
  const availableProviders = PROVIDERS.filter(p => allowed.some(m => m.provider === p));

  const provider = MODELS.find(m => m.id === selectedModel)?.provider ?? availableProviders[0];
  const models = allowed.filter(m => m.provider === provider);
  const selectedIndex = Math.max(
    models.findIndex(m => m.id === selectedModel),
    0
  );

  // Auto-correct model if it's not in the allowed list
  useEffect(() => {
    if (allowedModels && !allowedModels.includes(selectedModel) && allowed.length > 0) {
      onModelChange(allowed[0].id);
    }
  }, [allowedModels, selectedModel, allowed, onModelChange]);

  if (models.length === 0) {
    return null; // selected model not allowed — the auto-correct effect re-renders
  }

  const switchProvider = (target: typeof provider) => {
    if (target === provider) return;
    const targetModels = allowed.filter(m => m.provider === target);
    // Keep the position in the list when jumping between providers
    onModelChange(targetModels[Math.min(selectedIndex, targetModels.length - 1)].id);
  };

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
            className={`whitespace-nowrap px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed ${
              p === provider
                ? 'bg-stone-800 text-stone-50'
                : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800'
            }`}
          >
            {PROVIDER_LABELS[p]}
          </button>
        ))}
      </div>
      <select
        value={models[selectedIndex].id}
        disabled={disabled}
        onChange={e => onModelChange(e.target.value as ModelType)}
        className="rounded-md border border-stone-300 bg-white px-2 py-1 text-[11px] font-medium text-stone-700 shadow-sm disabled:cursor-not-allowed"
        aria-label={`${PROVIDER_LABELS[provider]} model`}
      >
        {models.map(m => (
          <option key={m.id} value={m.id} title={m.description}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
};
