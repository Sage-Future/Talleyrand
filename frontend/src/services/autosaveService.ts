import { client } from '../client';
import type { GraphData, GraphMetadata } from '../types';
import type { CaseFileData } from '../utils/fileOperations';
import { toGraphPayload } from '../utils/graphPayload';

/** The server refused the save because another window saved a newer revision
 * of this case first; the local state is stale and must be reloaded. The
 * message is user-facing: it surfaces as the reason when an action that
 * requires a save (asking a question, regenerating) fails in a stale tab. */
export class SaveConflictError extends Error {
  constructor() {
    super(
      'This case was edited in another tab or window, so this view is out of date. ' +
        'Reloading the latest version — try again after it loads.'
    );
  }
}

/** The server refused the save because the case is not there: it was
 * deleted, here or from another window. The local copy is an orphan — it can
 * never be saved again, and re-creating it would undo a delete the privacy
 * policy promises is immediate and final. */
export class CaseDeletedError extends Error {
  constructor() {
    super('This case was deleted, so there is nothing left to save it to.');
  }
}

export async function saveToBackend(
  graphData: GraphData,
  ackedJobIds: string[]
): Promise<{ id: string; revision: number } | undefined> {
  const { data, error, response } = await client.PUT('/graph/{graph_id}', {
    body: {
      name: graphData.name!,
      revision: graphData.revision,
      ...toGraphPayload(graphData),
      ackedJobIds,
    },
    params: {
      path: { graph_id: graphData.id },
    },
  });

  if (error) {
    if (response.status === 409) {
      throw new SaveConflictError();
    }
    if (response.status === 404) {
      throw new CaseDeletedError();
    }
    console.error('Failed to save to backend:', error);
    // A string detail is the server's user-facing explanation of why this
    // save can never succeed (e.g. 413: case too large, with what to remove);
    // surface it instead of a generic failure the caller would misattribute.
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === 'string') {
      throw new Error(detail);
    }
    return undefined;
  }

  return data as { id: string; revision: number };
}

/** Create a new case on the server from an imported case file.
 *
 * An import is a create, not a save: the file's own id and revision never
 * enter the account, and the server mints the id it is stored under. So an
 * import can neither collide with an existing case nor land on the id of a
 * deleted one. Returns the new case id for the caller to navigate to. */
export async function importGraph(caseData: CaseFileData): Promise<string> {
  const { data, error } = await client.POST('/graph/import', {
    body: {
      name: caseData.name,
      ...toGraphPayload(caseData),
    },
  });

  if (error) {
    // A string detail is a user-facing message (e.g. 413: case too large);
    // anything else is the server's field validation rejecting the file.
    const detail = (error as { detail?: unknown }).detail;
    throw new Error(
      typeof detail === 'string' ? detail : 'The file does not match the case export format.'
    );
  }

  return (data as { id: string }).id;
}

export async function listUserGraphs(): Promise<GraphMetadata[]> {
  const { data, error } = await client.GET('/graph/', {});

  if (error) {
    console.error('Failed to list graphs from backend:', error);
    throw new Error('Failed to load graphs from backend');
  }

  if (!data || !Array.isArray(data)) {
    return [];
  }

  return data as GraphMetadata[];
}

export async function loadGraphById(graphId: string): Promise<GraphData> {
  const { data, error } = await client.GET('/graph/{graph_id}', {
    params: { path: { graph_id: graphId } },
  });

  if (error) {
    console.error('Failed to load graph from backend:', error);
    throw new Error('Failed to load graph from backend');
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Invalid graph data received from backend');
  }

  return data as GraphData;
}

export async function deleteGraph(graphId: string): Promise<void> {
  const { error, response } = await client.DELETE('/graph/{graph_id}', {
    params: { path: { graph_id: graphId } },
  });

  // A case that is already gone is a delete that already happened — a retry
  // after a dropped response has nothing left to do and must not report
  // failure, which would leave the caller holding a case it has to close.
  if (error && response.status !== 404) {
    console.error('Failed to delete graph from backend:', error);
    throw new Error('Failed to delete graph from backend');
  }
}

export async function createNewGraph(): Promise<string> {
  const { data, error } = await client.POST('/graph/', {});

  if (error) {
    console.error('Failed to create new graph:', error);
    throw new Error('Failed to create new graph');
  }

  if (!data || typeof data !== 'object' || !('id' in data)) {
    throw new Error('Invalid response from backend');
  }

  return data.id as string;
}

export async function renameGraph(graphId: string, newName: string): Promise<void> {
  const { error } = await client.PATCH('/graph/{graph_id}/rename', {
    params: { path: { graph_id: graphId } },
    body: { name: newName },
  });

  if (error) {
    console.error('Failed to rename graph:', error);
    throw new Error('Failed to rename graph');
  }
}
