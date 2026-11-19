import { AGENT_BACKEND } from './constants';

export const PROVIDERS = ['claude_code', 'hermes'] as const;

export type ModelProvider = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<ModelProvider, string> = {
  claude_code: 'Claude Code',
  hermes: 'Hermes',
};

// The models each agent CLI can run on the operator's subscription, ordered
// from fastest to most capable — the picker's dropdown lists them in this order.
// inputTokens mirrors the backend's ModelWindow.max_input_tokens (model_settings.py):
// the most a request to the model may carry. A backend test keeps the two equal.
export const MODELS = [
  {
    id: 'claude-code-haiku-4-5',
    provider: 'claude_code',
    label: 'Claude Haiku 4.5',
    description: 'Fastest Claude, on your Claude subscription',
    inputTokens: 150000,
  },
  {
    id: 'claude-code-sonnet-5-5',
    provider: 'claude_code',
    label: 'Claude Sonnet 5.5',
    description: 'Balanced Claude, on your Claude subscription',
    inputTokens: 150000,
  },
  {
    id: 'claude-code-opus-5-5',
    provider: 'claude_code',
    label: 'Claude Opus 5.5',
    description: 'Strongest Opus, on your Claude subscription',
    inputTokens: 150000,
  },
  {
    id: 'claude-code-fable-5-1',
    provider: 'claude_code',
    label: 'Claude Fable 5.1',
    description: 'Most capable Claude, on your Claude subscription',
    inputTokens: 150000,
  },
  {
    id: 'hermes-gpt-6-luna',
    provider: 'hermes',
    label: 'GPT-6 Luna',
    description: 'Fastest GPT, on your ChatGPT subscription',
    inputTokens: 150000,
  },
  {
    id: 'hermes-gpt-6-sol',
    provider: 'hermes',
    label: 'GPT-6 Sol',
    description: 'Balanced GPT, on your ChatGPT subscription',
    inputTokens: 150000,
  },
  {
    id: 'hermes-gpt-6-1-sol',
    provider: 'hermes',
    label: 'GPT-6.1 Sol',
    description: 'Newest Sol, on your ChatGPT subscription',
    inputTokens: 150000,
  },
  {
    id: 'hermes-gpt-6-astra',
    provider: 'hermes',
    label: 'GPT-6 Astra',
    description: 'Most capable GPT, on your ChatGPT subscription',
    inputTokens: 150000,
  },
] as const satisfies readonly {
  id: string;
  provider: ModelProvider;
  label: string;
  description: string;
  inputTokens: number;
}[];

export type ModelType = (typeof MODELS)[number]['id'];

// The session defaults to the agent that runs its other work.
export const DEFAULT_MODEL: ModelType =
  AGENT_BACKEND === 'hermes' ? 'hermes-gpt-6-astra' : 'claude-code-sonnet-5-5';

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
  'gpt-5.4-nano-2026-03-17': { label: 'GPT-5.4 Nano', replacedBy: 'hermes-gpt-6-luna' },
  'gpt-5.4-mini-2026-03-17': { label: 'GPT-5.4 Mini', replacedBy: 'hermes-gpt-6-sol' },
  'gpt-5.5-medium': { label: 'GPT-5.5 medium', replacedBy: 'hermes-gpt-6-astra' },
  'gpt-5.5-high': { label: 'GPT-5.5 high', replacedBy: 'hermes-gpt-6-astra' },
  'gpt-5.5-xhigh': { label: 'GPT-5.5 xhigh', replacedBy: 'hermes-gpt-6-astra' },
  // Retired 2026-08-18 for Claude 5
  'claude-sonnet-4-6': { label: 'Claude Sonnet 4.6', replacedBy: 'claude-code-sonnet-5-5' },
  'claude-opus-4-8-medium': {
    label: 'Claude Opus 4.8 medium',
    replacedBy: 'claude-code-fable-5-1',
  },
  'claude-opus-4-8-high': { label: 'Claude Opus 4.8 high', replacedBy: 'claude-code-fable-5-1' },
  'claude-opus-4-8-xhigh': { label: 'Claude Opus 4.8 xhigh', replacedBy: 'claude-code-fable-5-1' },
  // Retired 2026-09-09 for GPT-6 Astra
  'gpt-5.6-sol-medium': { label: 'GPT-5.6 Sol medium', replacedBy: 'hermes-gpt-6-astra' },
  'gpt-5.6-sol-high': { label: 'GPT-5.6 Sol high', replacedBy: 'hermes-gpt-6-astra' },
  'gpt-5.6-sol-max': { label: 'GPT-5.6 Sol max', replacedBy: 'hermes-gpt-6-astra' },
  // Retired 2026-09-09 for Claude Fable 5.1
  'claude-opus-5-medium': { label: 'Claude Opus 5 medium', replacedBy: 'claude-code-fable-5-1' },
  'claude-opus-5-high': { label: 'Claude Opus 5 high', replacedBy: 'claude-code-fable-5-1' },
  'claude-opus-5-max': { label: 'Claude Opus 5 max', replacedBy: 'claude-code-fable-5-1' },
  // Retired 2026-09-30: one preset per agent became one per model it can run
  'claude-code': { label: 'Claude Code', replacedBy: 'claude-code-sonnet-5-5' },
  hermes: { label: 'Hermes', replacedBy: 'hermes-gpt-6-astra' },
  // Retired 2026-09-30 with the API-key providers: each runs on the agent CLI
  // that serves its model family
  'gpt-5.6-luna': { label: 'GPT-5.6 Luna', replacedBy: 'hermes-gpt-6-luna' },
  'gpt-5.6-terra': { label: 'GPT-5.6 Terra', replacedBy: 'hermes-gpt-6-sol' },
  'gpt-6-astra-medium': { label: 'GPT-6 Astra medium', replacedBy: 'hermes-gpt-6-astra' },
  'gpt-6-astra-high': { label: 'GPT-6 Astra high', replacedBy: 'hermes-gpt-6-astra' },
  'gpt-6-astra-max': { label: 'GPT-6 Astra max', replacedBy: 'hermes-gpt-6-astra' },
  'claude-haiku-4-5': { label: 'Claude Haiku 4.5', replacedBy: 'claude-code-haiku-4-5' },
  'claude-sonnet-5': { label: 'Claude Sonnet 5', replacedBy: 'claude-code-sonnet-5-5' },
  'claude-fable-5-1-medium': {
    label: 'Claude Fable 5.1 medium',
    replacedBy: 'claude-code-fable-5-1',
  },
  'claude-fable-5-1-high': { label: 'Claude Fable 5.1 high', replacedBy: 'claude-code-fable-5-1' },
  'claude-fable-5-1-max': { label: 'Claude Fable 5.1 max', replacedBy: 'claude-code-fable-5-1' },
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
