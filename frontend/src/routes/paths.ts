/**
 * Addresses of the case view.
 *
 * A question is named in the URL by the first 8 characters of its id: short
 * enough to keep the address readable next to the case id, wide enough that
 * two questions of one case sharing an abbreviation is a one-in-a-million
 * event (and one that resolves to "no such question" rather than to the wrong
 * one).
 */

const QUESTION_URL_ID_LENGTH = 8;

/** The address of the empty composer for a new root-level question. */
export const NEW_QUESTION_SEGMENT = 'new';

export const questionUrlId = (nodeId: string): string => nodeId.slice(0, QUESTION_URL_ID_LENGTH);

export const casePath = (caseId: string): string => `/research/${caseId}`;

export const questionPath = (caseId: string, nodeId: string): string =>
  `${casePath(caseId)}/${questionUrlId(nodeId)}`;

export const newQuestionPath = (caseId: string): string =>
  `${casePath(caseId)}/${NEW_QUESTION_SEGMENT}`;

/**
 * The question an address names, or null when no single question of the case
 * answers to it — a question deleted since, a hand-edited address, or two
 * questions sharing the abbreviation.
 */
export const resolveQuestionUrlId = (urlId: string, nodeIds: string[]): string | null => {
  const matches = nodeIds.filter(id => questionUrlId(id) === urlId);
  return matches.length === 1 ? matches[0] : null;
};
