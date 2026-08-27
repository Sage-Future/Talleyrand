import type { ModelType } from '../config/models';
import type { GraphNode } from '../stores/graphStructureStore';
export type { ModelType };

// A directed edge in the question graph: source is the parent question,
// target the follow-up filed under it.
export interface Edge {
  id: string;
  source: string;
  target: string;
}

type DocumentType = 'txt' | 'pdf';

export interface Document {
  id: string;
  name: string;
  type: DocumentType;
  content: string; // Raw text for txt, base64 for pdf
}

export interface TextSelection {
  text: string;
  startOffset?: number;
  endOffset?: number;
  prefix?: string;
  suffix?: string;
  rect?: DOMRect | null;
  childNodeId?: string;
}

// A passage the user marked as an insight via the lightbulb in the selection
// popup. Anchored to the answer text like a TextSelection (so it reuses the
// annotation rendering), but standalone — it spawns no child question. Strong
// positive signal of what the user found important; fed to the answerer, the
// suggesters, and the report.
export interface Highlight {
  id: string;
  text: string;
  startOffset?: number;
  endOffset?: number;
  prefix?: string;
  suffix?: string;
  createdAt: string;
}

export interface PopupPosition {
  x: number;
  y: number;
}

export interface GraphMetadata {
  id: string;
  name: string;
  nodeCount: number;
  edgeCount: number;
  createdAt?: string;
  /** True while anyone holding the case's link can read it. */
  shared: boolean;
  /** Names of the case files a share link hands out along with the case. */
  documentNames: string[];
}

export type DeclineReason = 'know_this' | 'too_basic' | 'off_topic' | 'unclear';

// A question proposed by the system, awaiting accept/decline in the research view.
// Pending under its parent question until accepted or declined — no lifespan.
export interface ResearchSuggestion {
  id: string;
  parentNodeId: string;
  text: string;
  // Marks questions from the big-picture suggester (distinct, more prominent styling)
  bigPicture: boolean;
  createdAt: string;
}

// A suggestion the user explicitly declined; feeds the suggester as an anti-target
export interface DeclinedQuestion {
  text: string;
  reason: DeclineReason | null;
  parentNodeId: string | null;
  declinedAt: string;
}

// A first-read event: the user has read the answer of the given node
export interface ReadEvent {
  nodeId: string;
  at: string;
}

export interface GraphData {
  // Structure data
  id: string;
  name: string | null;
  // Optimistic-concurrency token: the server returns it on load and every save
  // must echo it back; a mismatch (409) means another window saved first.
  revision: number;
  nodes: GraphNode[];
  edges: Edge[];
  // Content data (Map needs to be converted to array for JSON)
  nodeContents: NodeContent[];
  // Research view data
  brief: string;
  caseDocuments: Document[];
  suggestions: ResearchSuggestion[];
  declinedQuestions: DeclinedQuestion[];
  readHistory: ReadEvent[];
}

// One page a web search put in front of the model while it wrote an answer.
// Cited sources are already linked inline in the answer text; the rest are what
// the model looked at and passed over. Only Claude titles every result.
export interface WebSource {
  url: string;
  title?: string | null;
  pageAge?: string | null;
  cited: boolean;
}

// Node content (business data)
export interface NodeContent {
  id: string;
  // Core content
  query: string;
  response: string;

  // Model configuration
  selectedModel: ModelType;

  // Documents
  documents: Document[];

  // Parent context
  parentSelectedText?: string;
  parentSelectedPrefix?: string;
  parentSelectedSuffix?: string;

  // Suggestions offered in the selection popup
  selectionSuggestions: string[];

  // Selections (for child nodes)
  selections: TextSelection[];

  // Passages the user marked as insights via the lightbulb in the selection popup
  highlights: Highlight[];

  // The thread above this question, condensed into a cheat sheet by the
  // backend when "summarize parents" is on. Derived material: it stands in for
  // the collapsed ancestors in the thread header, and never enters a prompt.
  cheatSheet?: string | null;

  // Whole answer marked as especially useful by the user (the heart toggle).
  // Strong positive signal fed to the answerer, suggesters and report. Null/absent = not loved.
  lovedAt?: string | null;

  // What the answer's web searches turned up, cited or not. Recorded with the
  // answer and replaced when it is regenerated; never enters a prompt.
  sources: WebSource[];
  // How many pages the searches surfaced in total — more than the list above
  // when the haul was too big to keep whole.
  sourcesFound: number;

  // Research view metadata (informational, never load-bearing)
  answeredAt?: string | null;
  resolvedAt?: string | null;
}

// Node UI state (presentation data)
export interface NodeUIState {
  // Selection popup
  showSelectionPopup: boolean;
  popupPosition?: PopupPosition;
  selectionInfo: TextSelection | null;
  popupQuery: string;
  isLoadingSelectionSuggestions: boolean;
}
