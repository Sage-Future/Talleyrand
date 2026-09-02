import React, { FC, useRef, useEffect, useState, useCallback } from 'react';
import type { PopupPosition, TextSelection } from '../../types';
import { SuggestionDropdown } from './SuggestionDropdown';
import { useSuggestionKeyboard } from '../../hooks/useSuggestionKeyboard';
import { insertNewline } from '../../utils/insertNewline';
import { iconTooltip } from './TooltipLayer';

interface SelectionPopupProps {
  position: PopupPosition;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  selection?: TextSelection | null;
  placeholder?: string;
  suggestions?: string[];
  isLoadingSuggestions?: boolean;
  onSuggestionSelect?: (suggestion: string) => void;
  // When provided, a lightbulb button marks the selection as an insight
  // highlight. Research-only — the canvas surfaces leave it unset.
  onHighlight?: () => void;
}

export const SelectionPopup: FC<SelectionPopupProps> = ({
  position,
  value,
  onChange,
  onSubmit,
  onClose,
  selection,
  placeholder = 'Ask about selected text...',
  suggestions = [],
  isLoadingSuggestions = false,
  onSuggestionSelect,
  onHighlight,
}) => {
  // Wraps the popup and its suggestion list, so an outside click can tell
  // "still in the popup" from "somewhere else".
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);

  const handleSuggestionSelectInternal = useCallback(
    (suggestion: string) => {
      onChange(suggestion);
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);
      onSuggestionSelect?.(suggestion);
    },
    [onChange, onSuggestionSelect]
  );

  // Use shared keyboard navigation hook
  const { handleKeyDown: handleSuggestionKeyDown } = useSuggestionKeyboard({
    suggestions,
    selectedIndex: selectedSuggestionIndex,
    setSelectedIndex: setSelectedSuggestionIndex,
    onSelect: handleSuggestionSelectInternal,
    isActive: showSuggestions,
  });

  // The textarea is not autofocused, so its own Escape handler only applies
  // once the user clicks into it; this closes the popup when Escape is pressed
  // with focus still elsewhere. Events from inside the popup are left to the
  // textarea path (where Escape may just close the suggestion dropdown).
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (popupRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Clicking anywhere outside dismisses the popup, same as the close button.
  // Bound on mousedown so the popup is gone before the click lands, and so a
  // drag that starts outside never leaves a stale popup behind.
  useEffect(() => {
    const handleOutsideMouseDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', handleOutsideMouseDown);
    return () => document.removeEventListener('mousedown', handleOutsideMouseDown);
  }, [onClose]);

  // The native selection survives while the popup is open (nothing rewrites
  // the selected DOM range and focus stays put), so copying is native. It dies
  // the moment the user clicks into the textarea; from then on Cmd/Ctrl+C
  // copies the captured passage — unless the user has an actual live
  // selection (e.g. inside the textarea).
  useEffect(() => {
    const selectedText = selection?.text;
    if (!selectedText) return;

    const handleCopyShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      // event.code is keyboard-layout independent (e.g. Cyrillic layouts)
      if (event.code !== 'KeyC' || event.shiftKey || event.altKey) return;

      const textarea = textareaRef.current;
      if (
        textarea &&
        document.activeElement === textarea &&
        textarea.selectionStart !== textarea.selectionEnd
      ) {
        return;
      }
      const docSelection = window.getSelection();
      if (docSelection && !docSelection.isCollapsed) return;

      event.preventDefault();
      void navigator.clipboard.writeText(selectedText);
    };

    document.addEventListener('keydown', handleCopyShortcut);
    return () => document.removeEventListener('keydown', handleCopyShortcut);
  }, [selection?.text]);

  // Auto-resize textarea based on content
  useEffect(() => {
    if (textareaRef.current) {
      // Reset to single line height, then expand if content requires more
      textareaRef.current.style.height = '1.5rem';
      const scrollHeight = textareaRef.current.scrollHeight;
      const minHeight = parseFloat(getComputedStyle(textareaRef.current).fontSize) * 1.5;
      if (scrollHeight > minHeight) {
        textareaRef.current.style.height = `${scrollHeight}px`;
      }
    }
  }, [value]);

  // Show suggestions when component mounts and when suggestions are loaded
  useEffect(() => {
    // Show suggestions if input is empty
    if (!value && (suggestions.length > 0 || isLoadingSuggestions)) {
      setShowSuggestions(true);
    } else if (value) {
      // Hide suggestions when user types
      setShowSuggestions(false);
    }
  }, [value, suggestions, isLoadingSuggestions]);

  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedSuggestionIndex(-1);
  }, [suggestions]);

  // Prevent React Flow zoom when scrolling the textarea
  const handleWheel = (e: React.WheelEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    e.preventDefault();
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.scrollTop += e.deltaY;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ⌘/Ctrl+Enter breaks the line instead of asking — ahead of the suggestion
    // list, which would otherwise take the Enter to pick its highlighted row.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      insertNewline(e.currentTarget);
      return;
    }

    // Try suggestion keyboard handling first
    if (handleSuggestionKeyDown(e)) {
      e.preventDefault();
      return;
    }

    // Handle popup-specific keys
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    // display:contents — the wrapper groups the two floating layers for the
    // outside-click check without introducing a box of its own.
    <div ref={rootRef} className="contents">
      <div
        ref={popupRef}
        className="absolute bg-white border border-gray-200 rounded-xl p-1 pr-3 flex gap-1 items-start shadow-2xl min-w-[400px] z-[9999]"
        style={{
          left: position.x,
          top: position.y,
          transform: 'translateX(-50%)',
        }}
      >
        {/* Arrow pointing upward */}
        <div
          className="absolute w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[8px] border-b-gray-200"
          style={{
            left: '50%',
            top: '-8px',
            transform: 'translateX(-50%)',
          }}
        />
        <div
          className="absolute w-0 h-0 border-l-[7px] border-l-transparent border-r-[7px] border-r-transparent border-b-[7px] border-b-white"
          style={{
            left: '50%',
            top: '-7px',
            transform: 'translateX(-50%)',
          }}
        />

        {/* Close button - top right */}
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 w-6 h-6 bg-white border border-gray-300 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors shadow-sm"
          {...iconTooltip('Close')}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {/* Input area */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onWheel={handleWheel}
          placeholder={placeholder}
          className="flex-1 px-2 py-0.5 text-xs bg-transparent focus:outline-none min-w-[200px] resize-none overflow-y-auto leading-normal"
          style={{ height: '1.5rem', maxHeight: '7.5rem' }}
        />

        {/* Action buttons */}
        <div className="flex gap-1 self-start">
          {onHighlight && (
            <button
              onClick={onHighlight}
              className="w-6 h-6 rounded-md bg-yellow-100 text-yellow-700 hover:bg-yellow-200 transition-colors flex items-center justify-center flex-shrink-0"
              {...iconTooltip('Mark as insight')}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 18h6M10 21h4M12 3a6 6 0 00-3.6 10.8c.5.38.8.96.85 1.58l.05.62h5.4l.05-.62c.05-.62.35-1.2.85-1.58A6 6 0 0012 3z"
                />
              </svg>
            </button>
          )}
          <button
            onClick={onSubmit}
            disabled={!value.trim()}
            className="w-6 h-6 rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 transition-colors flex items-center justify-center flex-shrink-0"
            {...iconTooltip('Ask about selection')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 5l7 7-7 7M5 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>
      </div>

      {showSuggestions && (
        <SuggestionDropdown
          suggestions={suggestions}
          isLoading={isLoadingSuggestions}
          onSelect={handleSuggestionSelectInternal}
          position={position}
          selectedIndex={selectedSuggestionIndex}
          onHover={setSelectedSuggestionIndex}
        />
      )}
    </div>
  );
};
