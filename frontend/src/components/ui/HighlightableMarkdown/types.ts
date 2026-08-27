/**
 * TypeScript types for the HighlightableMarkdown component.
 */

export type BlockKind = 'paragraph' | 'heading' | 'code_block' | 'table_cell' | 'list_item';

export interface Block {
  blockId: string;
  kind: BlockKind;
  text: string;
}

// Annotation markers: visual highlights over the answer text
// - 'child-selection': a passage a follow-up question was asked about
// - 'insight': a passage the user marked with the lightbulb
export type MarkerKind = 'child-selection' | 'insight';

export interface Annotation {
  id: string;
  blockId: string;
  start: number;
  end: number;
  // Matches the marker; used for CSS class naming
  type: string;
  marker: MarkerKind;
  childNodeId?: string;
  // Set for 'insight' markers — the id of the Highlight, so the mark can remove it
  insightId?: string;
}

export interface Segment {
  start: number;
  end: number;
  annotationIds: string[];
}
