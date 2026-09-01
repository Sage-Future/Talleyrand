import { FC, ReactNode, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { type ModelType, MODELS, resolveModelId } from '../config/models';
import { ModelPicker } from './ui/ModelPicker';
import { useResearchStore } from '../stores/researchStore';
import { iconTooltip } from './ui/TooltipLayer';
import { AuthService } from '../services/authService';
import { saveNow } from '../services/autosaveSubscriptions';
import { useAuth } from '../contexts/AuthContext';
import { getConsent, isAnalyticsConfigured, setConsent } from '../services/analyticsConsent';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

const SectionLabel: FC<{ children: string }> = ({ children }) => (
  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
    {children}
  </span>
);

const SelectChevron: FC = () => (
  <svg
    className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const ApiKeyField: FC<{
  label: string;
  required?: boolean;
  hint: string;
  href: string;
  hrefLabel: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, required = false, hint, href, hrefLabel, placeholder, value, onChange }) => {
  const [showKey, setShowKey] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <SectionLabel>{label}</SectionLabel>
          <span
            className={`rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.12em] ${
              required ? 'bg-amber-100 text-amber-700' : 'bg-stone-200/70 text-stone-500'
            }`}
          >
            {required ? 'Required' : 'Optional'}
          </span>
        </div>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-stone-400 underline-offset-2 transition-colors hover:text-stone-700 hover:underline"
        >
          {hrefLabel} ↗
        </a>
      </div>
      <div className="relative">
        <input
          type={showKey ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-3 pr-10 font-serif text-[13.5px] text-stone-800 transition-all placeholder:text-stone-400 focus:border-stone-500 focus:shadow-[0_2px_12px_rgba(28,25,23,0.07)] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShowKey(!showKey)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700"
          {...iconTooltip(showKey ? 'Hide key' : 'Show key')}
        >
          {showKey ? (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"
              />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            </svg>
          )}
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-stone-400">{hint}</p>
    </div>
  );
};

const ToggleRow: FC<{
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: ReactNode;
}> = ({ id, checked, onChange, label, description }) => (
  <label htmlFor={id} className="group flex cursor-pointer items-start gap-2.5">
    <input
      type="checkbox"
      id={id}
      checked={checked}
      onChange={e => onChange(e.target.checked)}
      className="sr-only"
    />
    <span
      className={`mt-[3px] flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
        checked
          ? 'border-stone-900 bg-stone-900'
          : 'border-stone-300 bg-white group-hover:border-stone-500'
      }`}
    >
      <svg
        className={`h-2.5 w-2.5 ${checked ? 'text-stone-50' : 'text-transparent'}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} d="M5 13l4 4L19 7" />
      </svg>
    </span>
    <span className="min-w-0 flex-1">
      <span className="font-serif text-[13.5px] leading-snug text-stone-800">{label}</span>
      {description && (
        <span className="mt-0.5 block font-serif text-[12px] leading-snug text-stone-500">
          {description}
        </span>
      )}
    </span>
  </label>
);

export const SettingsModal: FC<SettingsModalProps> = ({ isOpen, onClose, onSave }) => {
  const { user } = useAuth();
  // Initialize state directly from localStorage
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('openai_api_key') || '');
  const [anthropicApiKey, setAnthropicApiKey] = useState(
    () => localStorage.getItem('anthropic_api_key') || ''
  );
  const [defaultModel, setDefaultModel] = useState<ModelType>(() =>
    resolveModelId(localStorage.getItem('default_model'))
  );
  const [webSearchEnabled, setWebSearchEnabled] = useState(
    () => localStorage.getItem('web_search_enabled') !== 'false'
  );
  const [verbosity, setVerbosity] = useState<'low' | 'normal'>(
    () => (localStorage.getItem('verbosity') as 'low' | 'normal') || 'low'
  );
  const [summarizeParents, setSummarizeParents] = useState(
    () => localStorage.getItem('summarize_parents') === 'true'
  );
  const [analyticsAllowed, setAnalyticsAllowed] = useState(() => getConsent() === 'granted');

  const currentDefaultModel = MODELS.find(m => m.id === defaultModel) ?? MODELS[0];

  // This modal stays mounted while closed, so its initial state is read once,
  // before the visitor has answered the consent banner. Consent also changes
  // outside the modal (the banner, the landing page's Cookies link), so read
  // the stored answer back every time the modal opens.
  useEffect(() => {
    if (isOpen) setAnalyticsAllowed(getConsent() === 'granted');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSave = () => {
    if (apiKey.trim()) {
      localStorage.setItem('openai_api_key', apiKey.trim());
    } else {
      localStorage.removeItem('openai_api_key');
    }
    if (anthropicApiKey.trim()) {
      localStorage.setItem('anthropic_api_key', anthropicApiKey.trim());
    } else {
      localStorage.removeItem('anthropic_api_key');
    }
    useResearchStore.getState().setDefaultModel(defaultModel);
    localStorage.setItem('web_search_enabled', webSearchEnabled.toString());
    localStorage.setItem('verbosity', verbosity);
    useResearchStore.getState().setSummarizeParents(summarizeParents);
    // Only when the toggle was actually moved. Saving unrelated settings must
    // not answer the consent question for a visitor who has not answered it —
    // that would dismiss the banner on their behalf.
    if (isAnalyticsConfigured() && analyticsAllowed !== (getConsent() === 'granted')) {
      setConsent(analyticsAllowed ? 'granted' : 'denied');
    }

    onSave();
    onClose();
  };

  const handleSignOut = async () => {
    if (
      !window.confirm(
        'Sign out? Your API keys are removed from this browser too, so you will need to paste them again next time.'
      )
    ) {
      return;
    }
    try {
      // Whatever the autosave is still holding can only be sent while the
      // session is alive — flush it before the tokens go.
      await saveNow();
    } catch (err) {
      console.error('Sign-out: the open case could not be saved:', err);
      if (!window.confirm('Your latest changes could not be saved. Sign out anyway?')) return;
    }
    AuthService.signOut();
  };

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div
      className="sheet-overlay-enter fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-[2px]"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet-enter flex max-h-[86vh] w-[560px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-paper shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-6 pb-4 pt-5">
          <div>
            <h2 className="font-serif text-xl text-stone-800">Settings</h2>
            <p className="mt-0.5 font-serif text-[12.5px] text-stone-500">
              Your keys, the default model, and how answers read.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700"
            {...iconTooltip('Close')}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
          {/* API Keys */}
          <div>
            <div className="mb-4">
              <ApiKeyField
                label="OpenAI API key"
                required
                hint="Powers questions, suggestions, and reports — the app doesn't work without it."
                href="https://platform.openai.com/api-keys"
                hrefLabel="Get a key from OpenAI"
                placeholder="sk-…"
                value={apiKey}
                onChange={setApiKey}
              />
            </div>
            <ApiKeyField
              label="Anthropic API key"
              hint="Only needed if you want answers from Claude models."
              href="https://console.anthropic.com/settings/keys"
              hrefLabel="Get a key from Anthropic"
              placeholder="sk-ant-…"
              value={anthropicApiKey}
              onChange={setAnthropicApiKey}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-stone-400">
              Keys are stored locally in this browser and sent to our server only to make model
              calls — we never keep them.
            </p>
          </div>

          {/* Default Model */}
          <div>
            <div className="mb-1.5">
              <SectionLabel>Default model</SectionLabel>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-stone-300 bg-white px-3 py-2">
              <ModelPicker selectedModel={defaultModel} onModelChange={setDefaultModel} />
              <span className="truncate font-serif text-[13px] text-stone-600">
                {currentDefaultModel.label}
              </span>
            </div>
          </div>

          {/* Query Options */}
          <div>
            <div className="mb-2.5">
              <SectionLabel>Query options</SectionLabel>
            </div>
            <div className="space-y-3">
              <ToggleRow
                id="webSearch"
                checked={webSearchEnabled}
                onChange={setWebSearchEnabled}
                label="Enable web search"
              />
              <ToggleRow
                id="summarizeParents"
                checked={summarizeParents}
                onChange={setSummarizeParents}
                label="Summarize parents"
                description="Each new answer also condenses the questions above it into a cheat sheet, so a deep thread opens as one refresher instead of a stack of old answers. Costs one extra model call per question."
              />
              <div className="flex items-start justify-between gap-4">
                <label htmlFor="verbosity" className="min-w-0">
                  <span className="font-serif text-[13.5px] leading-snug text-stone-800">
                    Verbosity
                  </span>
                  <span className="mt-0.5 block font-serif text-[12px] leading-snug text-stone-500">
                    Low (the default) produces concise answers; Normal lets them run longer.
                  </span>
                </label>
                <div className="relative flex-shrink-0">
                  <select
                    id="verbosity"
                    value={verbosity}
                    onChange={e => setVerbosity(e.target.value as 'low' | 'normal')}
                    className="cursor-pointer appearance-none rounded-lg border border-stone-300 bg-white py-1.5 pl-3 pr-8 font-serif text-[13px] text-stone-800 transition-all focus:border-stone-500 focus:shadow-[0_2px_12px_rgba(28,25,23,0.07)] focus:outline-none"
                  >
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                  <SelectChevron />
                </div>
              </div>
            </div>
          </div>

          {/* Privacy */}
          {isAnalyticsConfigured() && (
            <div>
              <div className="mb-2.5">
                <SectionLabel>Privacy</SectionLabel>
              </div>
              <ToggleRow
                id="analyticsAllowed"
                checked={analyticsAllowed}
                onChange={setAnalyticsAllowed}
                label="Allow usage analytics"
                description="Google Analytics counts visits and shows which parts of the app get used. It never receives your questions, answers, or documents. Turning this off also clears the cookies it set."
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 border-t border-stone-200 px-6 py-3.5">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={handleSignOut}
              className="flex-shrink-0 rounded-md px-2 py-1 text-[13px] text-stone-500 transition-colors hover:text-stone-800"
            >
              Sign out
            </button>
            {user?.email && (
              <span className="truncate font-serif text-[12px] text-stone-400">{user.email}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-md px-2 py-1 text-[13px] text-stone-500 transition-colors hover:text-stone-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="rounded-full bg-stone-900 px-5 py-2 font-serif text-[13.5px] text-stone-50 shadow-sm transition-colors hover:bg-stone-700"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
