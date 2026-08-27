import type { GraphData } from '../types';

/** A case file's contents — everything in a case except its identity (id,
 * revision), which never survives an export/import round trip. */
export type CaseFileData = Omit<GraphData, 'id' | 'revision' | 'name'> & { name: string };

/** Parse an exported case file. Checks the structural shape the app relies on
 * and normalizes fields older exports may lack; per-field validation happens
 * server-side when the imported case is saved. */
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

  return {
    // 'New case' opts an unnamed import into auto-naming
    name: typeof file.name === 'string' && file.name !== '' ? file.name : 'New case',
    nodes: file.nodes,
    edges: file.edges,
    nodeContents: file.nodeContents,
    brief: file.brief ?? '',
    caseDocuments: file.caseDocuments ?? [],
    suggestions: file.suggestions ?? [],
    declinedQuestions: file.declinedQuestions ?? [],
    readHistory: file.readHistory ?? [],
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
