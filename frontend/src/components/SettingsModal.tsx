import { FC, ReactNode, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { type ModelType, MODELS, resolveModelId } from '../config/models';
import { ModelPicker } from './ui/ModelPicker';
import { useResearchStore } from '../stores/researchStore';
import { iconTooltip } from './ui/TooltipLayer';
import { getSearchProvider, type SearchProvider } from '../client';

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
  // Initialize state directly from localStorage
  const [defaultModel, setDefaultModel] = useState<ModelType>(() =>
    resolveModelId(localStorage.getItem('default_model'))
  );
  const [webSearchEnabled, setWebSearchEnabled] = useState(
    () => localStorage.getItem('web_search_enabled') !== 'false'
  );
  const [searchProvider, setSearchProvider] = useState<SearchProvider>(getSearchProvider);
  const [verbosity, setVerbosity] = useState<'low' | 'normal'>(
    () => (localStorage.getItem('verbosity') as 'low' | 'normal') || 'low'
  );
  const [summarizeParents, setSummarizeParents] = useState(
    () => localStorage.getItem('summarize_parents') === 'true'
  );

  const currentDefaultModel = MODELS.find(m => m.id === defaultModel) ?? MODELS[0];

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSave = () => {
    useResearchStore.getState().setDefaultModel(defaultModel);
    localStorage.setItem('web_search_enabled', webSearchEnabled.toString());
    localStorage.setItem('search_provider', searchProvider);
    localStorage.setItem('verbosity', verbosity);
    useResearchStore.getState().setSummarizeParents(summarizeParents);

    onSave();
    onClose();
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
              The default model, and how answers read.
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
              {webSearchEnabled && (
                <div className="flex items-start justify-between gap-4">
                  <label htmlFor="searchProvider" className="min-w-0">
                    <span className="font-serif text-[13.5px] leading-snug text-stone-800">
                      Search with
                    </span>
                    <span className="mt-0.5 block font-serif text-[12px] leading-snug text-stone-500">
                      Needs that service&apos;s key in backend/.env: KAGI_API_KEY or
                      MIXEDBREAD_API_KEY.
                    </span>
                  </label>
                  <div className="relative flex-shrink-0">
                    <select
                      id="searchProvider"
                      value={searchProvider}
                      onChange={e => setSearchProvider(e.target.value as SearchProvider)}
                      className="cursor-pointer appearance-none rounded-lg border border-stone-300 bg-white py-1.5 pl-3 pr-8 font-serif text-[13px] text-stone-800 transition-all focus:border-stone-500 focus:shadow-[0_2px_12px_rgba(28,25,23,0.07)] focus:outline-none"
                    >
                      <option value="kagi">Kagi</option>
                      <option value="mixedbread">Mixedbread</option>
                    </select>
                    <SelectChevron />
                  </div>
                </div>
              )}
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-stone-200 px-6 py-3.5">
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
    </div>,
    document.body
  );
};
