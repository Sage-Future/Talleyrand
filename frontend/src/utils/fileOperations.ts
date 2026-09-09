import type { GraphData, NodeContent } from '../types';
import { httpUrl } from './webUrl';

/** A case file's contents — everything in a case except its identity (id,
 * revision), which never survives an export/import round trip. */
export type CaseFileData = Omit<GraphData, 'id' | 'revision' | 'name'> & { name: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasStrings = (value: unknown, ...fields: string[]): value is Record<string, unknown> =>
  isRecord(value) && fields.every(field => typeof value[field] === 'string');

/** The fields the app dereferences on the way to the screen without checking
 * them first. An import file is hand-writable, so what isn't caught here is
 * caught much later, as a blank render or a crash inside a component. */
const isNode = (value: unknown): boolean => hasStrings(value, 'id');
const isEdge = (value: unknown): boolean => hasStrings(value, 'id', 'source', 'target');
const isDocument = (value: unknown): boolean =>
  hasStrings(value, 'id', 'name', 'type', 'content') &&
  (value.type === 'txt' || value.type === 'pdf');

const isNodeContent = (value: unknown): boolean => hasStrings(value, 'id', 'query', 'response');

/** An answer's sources are the one part of an imported case that the reader's
 * browser is later handed as a URL. Nothing legitimate reaches this list but
 * pages a web search turned up, so a source that isn't a web address is either
 * corrupt or an attempt to smuggle a `javascript:` link into a source list. */
const sourcesAreWebAddresses = (content: NodeContent): boolean => {
  const sources: unknown = content.sources;
  if (sources === undefined) return true; // exports predating source tracking
  return Array.isArray(sources) && sources.every(source => httpUrl(source?.url) !== null);
};

/** Present and an array, or absent: research-view fields that older exports
 * simply lack, where an empty list is a truthful reading of the file. */
const optionalList = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const checked = <T>(items: unknown[], ok: (item: unknown) => boolean, what: string): T[] => {
  if (!items.every(ok)) throw new Error(`The file's ${what} are not in the expected shape.`);
  return items as T[];
};

/** Parse an exported case file. Checks the structural shape the app relies on
 * and normalizes fields older exports may lack; the rest of the per-field
 * validation happens server-side when the imported case is saved. */
export const parseCaseFile = (json: string): CaseFileData => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('The file is not valid JSON.');
  }

  const file = parsed as Partial<GraphData> | null;
  if (
    file === null ||
    typeof file !== 'object' ||
    !Array.isArray(file.nodes) ||
    !Array.isArray(file.edges) ||
    !Array.isArray(file.nodeContents)
  ) {
    throw new Error('The file is not a case export.');
  }

  const nodeContents = checked<NodeContent>(file.nodeContents, isNodeContent, 'answers');
  if (!nodeContents.every(sourcesAreWebAddresses)) {
    throw new Error('The file lists a source whose link is not a web address.');
  }

  return {
    // 'New case' opts an unnamed import into auto-naming
    name: typeof file.name === 'string' && file.name !== '' ? file.name : 'New case',
    nodes: checked(file.nodes, isNode, 'questions'),
    edges: checked(file.edges, isEdge, 'links between questions'),
    nodeContents,
    brief: typeof file.brief === 'string' ? file.brief : '',
    caseDocuments: checked(optionalList(file.caseDocuments), isDocument, 'attached documents'),
    suggestions: optionalList(file.suggestions),
    declinedQuestions: optionalList(file.declinedQuestions),
    readHistory: optionalList(file.readHistory),
  };
};

export const saveToFile = (content: string, filename: string): void => {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const loadFromFile = (): Promise<string> => {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = (event: Event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        const content = e.target?.result as string;
        resolve(content);
      };
      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };
      reader.readAsText(file);
    };

    input.click();
  });
};

export const generateFilename = (): string => {
  const date = new Date();
  const timestamp = date.toISOString().replace(/[:.]/g, '-').slice(0, -5);
  return `chatgraph-${timestamp}.json`;
};
