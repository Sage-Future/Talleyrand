import { useCallback } from 'react';

interface UseSuggestionKeyboardOptions {
  suggestions: string[];
  selectedIndex: number;
  setSelectedIndex: (index: number | ((prev: number) => number)) => void;
  onSelect: (suggestion: string) => void;
  onDismiss?: () => void;
  isActive: boolean;
}

interface KeyboardHandlers {
  handleKeyDown: (e: React.KeyboardEvent | KeyboardEvent) => boolean;
}

/**
 * Shared hook for keyboard navigation in suggestion dropdowns.
 * Returns handlers that can be used with either React events or document listeners.
 *
 * @returns handleKeyDown - Returns true if the key was handled (caller should preventDefault/stopPropagation)
 */
export function useSuggestionKeyboard({
  suggestions,
  selectedIndex,
  setSelectedIndex,
  onSelect,
  onDismiss,
  isActive,
}: UseSuggestionKeyboardOptions): KeyboardHandlers {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent | KeyboardEvent): boolean => {
      if (!isActive || suggestions.length === 0) return false;

      switch (e.key) {
        case 'ArrowDown':
          setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0));
          return true;

        case 'ArrowUp':
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1));
          return true;

        case 'Enter':
          if (selectedIndex >= 0 && suggestions[selectedIndex]) {
            onSelect(suggestions[selectedIndex]);
            return true;
          }
          return false;

        case 'Escape':
          onDismiss?.();
          return true;

        case 'Tab':
          onDismiss?.();
          return false; // Don't prevent default - let tab work normally

        default:
          return false;
      }
    },
    [isActive, suggestions, selectedIndex, setSelectedIndex, onSelect, onDismiss]
  );

  return { handleKeyDown };
}
