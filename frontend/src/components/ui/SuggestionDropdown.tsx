import React, { FC, useRef, useEffect } from 'react';

interface SuggestionDropdownProps {
  suggestions: string[];
  isLoading: boolean;
  onSelect: (suggestion: string) => void;
  position?: { x: number; y: number };
  selectedIndex?: number;
  onHover?: (index: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const SuggestionDropdown: FC<
  SuggestionDropdownProps & Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect'>
> = ({
  suggestions,
  isLoading,
  onSelect,
  position,
  selectedIndex = -1,
  onHover,
  className = '',
  style: customStyle,
  ...rest
}) => {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Prevent React Flow zoom when scrolling the dropdown
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    e.preventDefault();
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop += e.deltaY;
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [selectedIndex]);

  const defaultStyle: React.CSSProperties = position
    ? {
        left: position.x,
        top: position.y + 28,
        minWidth: '320px',
        transform: 'translateX(-50%)',
      }
    : {};

  return (
    <div
      {...rest}
      className={`absolute bg-white border border-gray-200 rounded-xl shadow-xl z-[10000] max-w-[350px] overflow-hidden ${className}`}
      style={{ ...defaultStyle, ...customStyle }}
    >
      <div className="px-2 py-1 border-b border-gray-100 bg-gray-50 text-[10px] text-gray-500">
        Suggestions (↑↓ navigate, Enter select)
      </div>
      {isLoading ? (
        <div className="px-2 py-1.5 text-gray-400 text-xs flex items-center gap-1.5">
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Generating...
        </div>
      ) : (
        <div
          ref={scrollContainerRef}
          className="divide-y divide-gray-100 max-h-[200px] overflow-y-auto"
          onWheel={handleWheel}
        >
          {suggestions.map((suggestion, index) => (
            <button
              key={index}
              ref={el => {
                itemRefs.current[index] = el;
              }}
              onClick={() => onSelect(suggestion)}
              onMouseEnter={() => onHover?.(index)}
              className={`block w-full text-left px-2 py-1.5 text-xs transition-colors focus:outline-none ${
                index === selectedIndex
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-700 hover:bg-indigo-50 hover:text-indigo-700'
              }`}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
