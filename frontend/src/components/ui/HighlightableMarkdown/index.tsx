/**
 * HighlightableMarkdown - Main component for rendering markdown with highlights.
 */

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import katex from 'katex';
import type { Annotation } from './types';
import { mergeOverlappingAnnotations } from './annotationMerger';
import { rehypeHighlight } from './rehypeHighlight';
import { rehypeQuestionRefs } from './rehypeQuestionRefs';
import { remarkAddBlockIds } from './remarkAddBlockIds';
import { HighlightMark } from './HighlightMark';
import { QuestionRef } from './QuestionRef';

// Model output is text: nothing in the app legitimately emits an image, while a
// rendered <img> would fetch an author-chosen remote URL the moment an answer
// appears — a silent outbound request carrying whatever the model put in it.
const DISALLOWED_ELEMENTS = ['img'];

const katexCache = new Map<string, string>();

function renderKatex(latex: string, displayMode: boolean): string {
  const key = displayMode ? `d:${latex}` : `i:${latex}`;
  let html = katexCache.get(key);
  if (html === undefined) {
    html = katex.renderToString(latex, { displayMode, throwOnError: false });
    katexCache.set(key, html);
  }
  return html;
}

interface HighlightableMarkdownProps {
  content: string;
  annotations?: Annotation[];
  /** Chip renderer for [[<node id>]] / [[1.2]] tokens; surfaces without the
   *  research stores (the shared case viewer) substitute one wired to their
   *  own data. */
  questionRefComponent?: typeof QuestionRef;
}

export const HighlightableMarkdown: React.FC<HighlightableMarkdownProps> = ({
  content,
  annotations = [],
  questionRefComponent = QuestionRef,
}) => {
  // Merge overlapping annotations
  const segmentsByBlock = useMemo(() => {
    return mergeOverlappingAnnotations(annotations);
  }, [annotations]);

  const annotationsById = useMemo(() => new Map(annotations.map(a => [a.id, a])), [annotations]);

  // Memoize plugin arrays to prevent ReactMarkdown from re-running plugins on every render
  const remarkPlugins = useMemo(() => [remarkMath, remarkGfm, remarkAddBlockIds], []);

  // rehypeQuestionRefs runs first so a highlight overlapping a ref token splits
  // the token's child text, not the chip element itself
  const rehypePlugins = useMemo(
    () => [rehypeQuestionRefs, [rehypeHighlight, { segmentsByBlock, annotationsById }]] as any,
    [segmentsByBlock, annotationsById]
  );

  const components = useMemo(
    () =>
      ({
        highlightMark: HighlightMark,
        questionRef: questionRefComponent,
        a: ({ node, ...props }: any) => <a target="_blank" rel="noopener noreferrer" {...props} />,
        code: ({ className, children, ...props }: any) => {
          const classes = className?.split(' ') ?? [];
          const isInlineMath = classes.includes('math-inline');
          const isDisplayMath = classes.includes('math-display');

          if (isInlineMath || isDisplayMath) {
            const latex = String(children);
            const html = renderKatex(latex, isDisplayMath);
            return (
              <span data-source-length={latex.length} dangerouslySetInnerHTML={{ __html: html }} />
            );
          }

          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        pre: ({ node, children, ...props }: any) => {
          // Display math is wrapped in <pre><code class="math-display">...</code></pre>.
          // When an annotation overlaps the formula, rehypeHighlight wraps it as
          // <pre><highlightMark><code class="math-display">...</code></highlightMark></pre>.
          // Check both cases to skip the <pre> wrapper for KaTeX display math.
          // Find a <code> element, looking through highlightMark wrappers
          const findCodeChild = (parent: any): any => {
            for (const child of parent?.children ?? []) {
              if (child.type !== 'element') continue;
              if (child.tagName === 'code') return child;
              if (child.tagName === 'highlightMark') {
                const inner = findCodeChild(child);
                if (inner) return inner;
              }
            }
            return null;
          };
          const codeChild = findCodeChild(node);
          if (codeChild) {
            const classes = Array.isArray(codeChild.properties?.className)
              ? codeChild.properties.className
              : [];
            if (classes.includes('math-display')) {
              return <div className="katex-display-wrapper">{children}</div>;
            }
          }
          return <pre {...props}>{children}</pre>;
        },
      }) as any,
    [questionRefComponent]
  );

  return (
    <div className="highlightable-markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
        disallowedElements={DISALLOWED_ELEMENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
