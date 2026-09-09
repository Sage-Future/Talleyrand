export const PROVIDERS = ['openai', 'anthropic'] as const;

export type ModelProvider = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<ModelProvider, string> = {
  openai: 'GPT',
  anthropic: 'Claude',
};

// Within each provider, models are ordered from fastest to deepest reasoning —
// the picker's thinking slider maps positions onto this order.
// contextTokens mirrors the backend's ModelConfig.context_tokens (model_settings.py).
export const MODELS = [
  {
    id: 'gpt-5.6-luna',
    provider: 'openai',
    label: 'GPT-5.6 Luna',
    description: 'Fastest, most economical',
    contextTokens: 1050000,
  },
  {
    id: 'gpt-5.6-terra',
    provider: 'openai',
    label: 'GPT-5.6 Terra',
    description: 'Balanced performance',
    contextTokens: 1050000,
  },
  {
    id: 'gpt-6-astra-medium',
    provider: 'openai',
    label: 'GPT-6 Astra medium',
    description: 'Most capable',
    contextTokens: 1050000,
  },
  {
    id: 'gpt-6-astra-high',
    provider: 'openai',
    label: 'GPT-6 Astra high',
    description: 'High-quality reasoning',
    contextTokens: 1050000,
  },
  {
    id: 'gpt-6-astra-max',
    provider: 'openai',
    label: 'GPT-6 Astra max',
    description: 'Deepest reasoning (max)',
    contextTokens: 1050000,
  },
  {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    label: 'Claude Haiku 4.5',
    description: 'Fastest Claude',
    contextTokens: 200000,
  },
  {
    id: 'claude-sonnet-5',
    provider: 'anthropic',
    label: 'Claude Sonnet 5',
    description: 'Balanced Claude',
    contextTokens: 1000000,
  },
  {
    id: 'claude-fable-5-1-medium',
    provider: 'anthropic',
    label: 'Claude Fable 5.1 medium',
    description: 'Most capable Claude',
    contextTokens: 1000000,
  },
  {
    id: 'claude-fable-5-1-high',
    provider: 'anthropic',
    label: 'Claude Fable 5.1 high',
    description: 'High-quality reasoning',
    contextTokens: 1000000,
  },
  {
    id: 'claude-fable-5-1-max',
    provider: 'anthropic',
    label: 'Claude Fable 5.1 max',
    description: 'Deepest reasoning (max)',
    contextTokens: 1000000,
  },
] as const satisfies readonly {
  id: string;
  provider: ModelProvider;
  label: string;
  description: string;
  contextTokens: number;
}[];

export type ModelType = (typeof MODELS)[number]['id'];

export const DEFAULT_MODEL: ModelType = 'gpt-6-astra-medium';

// Presets we have removed, each pointing at its closest current replacement.
// Mirrors RETIRED_MODELS in the backend's model_settings.py, plus the label the
// model used to carry, so an answer written before a bump still shows the model
// that actually wrote it instead of a raw id.
//
// When retiring a model: delete it from MODELS above and add one line here.
// The map is one hop deep: when a replacement is itself retired, every entry
// that pointed at it is re-pointed at the new replacement.
export const RETIRED_MODELS: Record<string, { label: string; replacedBy: ModelType }> = {
  // Retired 2026-08-18 for the GPT-5.6 family, whose Sol tier has since given
  // way to GPT-6 Astra
  'gpt-5.4-nano-2026-03-17': { label: 'GPT-5.4 Nano', replacedBy: 'gpt-5.6-luna' },
  'gpt-5.4-mini-2026-03-17': { label: 'GPT-5.4 Mini', replacedBy: 'gpt-5.6-terra' },
  'gpt-5.5-medium': { label: 'GPT-5.5 medium', replacedBy: 'gpt-6-astra-medium' },
  'gpt-5.5-high': { label: 'GPT-5.5 high', replacedBy: 'gpt-6-astra-high' },
  'gpt-5.5-xhigh': { label: 'GPT-5.5 xhigh', replacedBy: 'gpt-6-astra-max' },
  // Retired 2026-08-18 for Claude 5, whose Opus tier has since given way to
  // Claude Fable 5.1
  'claude-sonnet-4-6': { label: 'Claude Sonnet 4.6', replacedBy: 'claude-sonnet-5' },
  'claude-opus-4-8-medium': {
    label: 'Claude Opus 4.8 medium',
    replacedBy: 'claude-fable-5-1-medium',
  },
  'claude-opus-4-8-high': { label: 'Claude Opus 4.8 high', replacedBy: 'claude-fable-5-1-high' },
  'claude-opus-4-8-xhigh': { label: 'Claude Opus 4.8 xhigh', replacedBy: 'claude-fable-5-1-max' },
  // Retired 2026-09-09, replaced by GPT-6 Astra
  'gpt-5.6-sol-medium': { label: 'GPT-5.6 Sol medium', replacedBy: 'gpt-6-astra-medium' },
  'gpt-5.6-sol-high': { label: 'GPT-5.6 Sol high', replacedBy: 'gpt-6-astra-high' },
  'gpt-5.6-sol-max': { label: 'GPT-5.6 Sol max', replacedBy: 'gpt-6-astra-max' },
  // Retired 2026-09-09, replaced by Claude Fable 5.1
  'claude-opus-5-medium': { label: 'Claude Opus 5 medium', replacedBy: 'claude-fable-5-1-medium' },
  'claude-opus-5-high': { label: 'Claude Opus 5 high', replacedBy: 'claude-fable-5-1-high' },
  'claude-opus-5-max': { label: 'Claude Opus 5 max', replacedBy: 'claude-fable-5-1-max' },
};

/** Current preset for a stored id, translating retired ids to their replacements. */
export function resolveModelId(modelId: string | undefined | null): ModelType {
  if (!modelId) return DEFAULT_MODEL;
  if (MODELS.some(m => m.id === modelId)) return modelId as ModelType;
  return RETIRED_MODELS[modelId]?.replacedBy ?? DEFAULT_MODEL;
}

/** Display name for a stored id — names the model that actually ran, retired or not. */
export function modelLabel(modelId: string): string {
  return MODELS.find(m => m.id === modelId)?.label ?? RETIRED_MODELS[modelId]?.label ?? modelId;
}

/** Provider that runs a stored model id, translating retired ids to their replacements. */
export function modelProvider(modelId: string | undefined | null): ModelProvider {
  const id = resolveModelId(modelId);
  return (MODELS.find(m => m.id === id) ?? MODELS[0]).provider;
}

/** Whether a stored id names a model that has since been retired. */
export function isRetiredModel(modelId: string | undefined | null): boolean {
  return !!modelId && modelId in RETIRED_MODELS;
}
