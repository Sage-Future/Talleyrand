export const PROVIDERS = ['openai', 'anthropic'] as const;

export type ModelProvider = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<ModelProvider, string> = {
  openai: 'GPT',
  anthropic: 'Claude',
};

// Within each provider, models are ordered from fastest to deepest reasoning —
// the picker's thinking slider maps positions onto this order.
// inputTokens mirrors the backend's ModelWindow.max_input_tokens (model_settings.py):
// the most a request to the model may carry. A backend test keeps the two equal.
export const MODELS = [
  {
    id: 'gpt-6-luna',
    provider: 'openai',
    label: 'GPT-6 Luna',
    description: 'Fastest, most economical',
    inputTokens: 922000,
  },
  {
    id: 'gpt-6.2-sol',
    provider: 'openai',
    label: 'GPT-6.2 Sol',
    description: 'Balanced performance',
    inputTokens: 922000,
  },
  {
    id: 'gpt-6.2-astra-medium',
    provider: 'openai',
    label: 'GPT-6.2 Astra medium',
    description: 'Most capable',
    inputTokens: 922000,
  },
  {
    id: 'gpt-6.2-astra-high',
    provider: 'openai',
    label: 'GPT-6.2 Astra high',
    description: 'High-quality reasoning',
    inputTokens: 922000,
  },
  {
    id: 'gpt-6.2-astra-max',
    provider: 'openai',
    label: 'GPT-6.2 Astra max',
    description: 'Deepest reasoning (max)',
    inputTokens: 922000,
  },
  {
    id: 'claude-haiku-5-5',
    provider: 'anthropic',
    label: 'Claude Haiku 5.5',
    description: 'Fastest Claude',
    inputTokens: 936000,
  },
  {
    id: 'claude-sonnet-5-5',
    provider: 'anthropic',
    label: 'Claude Sonnet 5.5',
    description: 'Balanced Claude',
    inputTokens: 936000,
  },
  {
    id: 'claude-fable-5-2-medium',
    provider: 'anthropic',
    label: 'Claude Fable 5.2 medium',
    description: 'Most capable Claude',
    inputTokens: 936000,
  },
  {
    id: 'claude-fable-5-2-high',
    provider: 'anthropic',
    label: 'Claude Fable 5.2 high',
    description: 'High-quality reasoning',
    inputTokens: 936000,
  },
  {
    id: 'claude-fable-5-2-max',
    provider: 'anthropic',
    label: 'Claude Fable 5.2 max',
    description: 'Deepest reasoning (max)',
    inputTokens: 936000,
  },
] as const satisfies readonly {
  id: string;
  provider: ModelProvider;
  label: string;
  description: string;
  inputTokens: number;
}[];

export type ModelType = (typeof MODELS)[number]['id'];

export const DEFAULT_MODEL: ModelType = 'gpt-6.2-astra-medium';

// Presets we have removed, each pointing at its closest current replacement.
// Mirrors RETIRED_MODELS in the backend's model_settings.py, plus the label the
// model used to carry, so an answer written before a bump still shows the model
// that actually wrote it instead of a raw id.
//
// When retiring a model: delete it from MODELS above and add one line here.
// The map is one hop deep: when a replacement is itself retired, every entry
// that pointed at it is re-pointed at the new replacement.
export const RETIRED_MODELS: Record<string, { label: string; replacedBy: ModelType }> = {
  // Retired 2026-08-18 for the GPT-5.6 family
  'gpt-5.4-nano-2026-03-17': { label: 'GPT-5.4 Nano', replacedBy: 'gpt-6-luna' },
  'gpt-5.4-mini-2026-03-17': { label: 'GPT-5.4 Mini', replacedBy: 'gpt-6.2-sol' },
  'gpt-5.5-medium': { label: 'GPT-5.5 medium', replacedBy: 'gpt-6.2-astra-medium' },
  'gpt-5.5-high': { label: 'GPT-5.5 high', replacedBy: 'gpt-6.2-astra-high' },
  'gpt-5.5-xhigh': { label: 'GPT-5.5 xhigh', replacedBy: 'gpt-6.2-astra-max' },
  // Retired 2026-08-18 for Claude 5
  'claude-sonnet-4-6': { label: 'Claude Sonnet 4.6', replacedBy: 'claude-sonnet-5-5' },
  'claude-opus-4-8-medium': {
    label: 'Claude Opus 4.8 medium',
    replacedBy: 'claude-fable-5-2-medium',
  },
  'claude-opus-4-8-high': { label: 'Claude Opus 4.8 high', replacedBy: 'claude-fable-5-2-high' },
  'claude-opus-4-8-xhigh': { label: 'Claude Opus 4.8 xhigh', replacedBy: 'claude-fable-5-2-max' },
  // Retired 2026-09-09 for GPT-6 Astra
  'gpt-5.6-sol-medium': { label: 'GPT-5.6 Sol medium', replacedBy: 'gpt-6.2-astra-medium' },
  'gpt-5.6-sol-high': { label: 'GPT-5.6 Sol high', replacedBy: 'gpt-6.2-astra-high' },
  'gpt-5.6-sol-max': { label: 'GPT-5.6 Sol max', replacedBy: 'gpt-6.2-astra-max' },
  // Retired 2026-09-09 for Claude Fable 5.1
  'claude-opus-5-medium': { label: 'Claude Opus 5 medium', replacedBy: 'claude-fable-5-2-medium' },
  'claude-opus-5-high': { label: 'Claude Opus 5 high', replacedBy: 'claude-fable-5-2-high' },
  'claude-opus-5-max': { label: 'Claude Opus 5 max', replacedBy: 'claude-fable-5-2-max' },
  // Retired 2026-11-19 for GPT-6 Luna, GPT-6.2 Sol and GPT-6.2 Astra
  'gpt-5.6-luna': { label: 'GPT-5.6 Luna', replacedBy: 'gpt-6-luna' },
  'gpt-5.6-terra': { label: 'GPT-5.6 Terra', replacedBy: 'gpt-6.2-sol' },
  'gpt-6-astra-medium': { label: 'GPT-6 Astra medium', replacedBy: 'gpt-6.2-astra-medium' },
  'gpt-6-astra-high': { label: 'GPT-6 Astra high', replacedBy: 'gpt-6.2-astra-high' },
  'gpt-6-astra-max': { label: 'GPT-6 Astra max', replacedBy: 'gpt-6.2-astra-max' },
  // Retired 2026-11-19 for Claude Haiku 5.5, Sonnet 5.5 and Fable 5.2
  'claude-haiku-4-5': { label: 'Claude Haiku 4.5', replacedBy: 'claude-haiku-5-5' },
  'claude-sonnet-5': { label: 'Claude Sonnet 5', replacedBy: 'claude-sonnet-5-5' },
  'claude-fable-5-1-medium': {
    label: 'Claude Fable 5.1 medium',
    replacedBy: 'claude-fable-5-2-medium',
  },
  'claude-fable-5-1-high': { label: 'Claude Fable 5.1 high', replacedBy: 'claude-fable-5-2-high' },
  'claude-fable-5-1-max': { label: 'Claude Fable 5.1 max', replacedBy: 'claude-fable-5-2-max' },
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
