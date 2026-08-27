/**
 * Enter sends a question, so breaking the line needs its own chord. Shift+Enter
 * the browser types by itself; ⌘/Ctrl+Enter it ignores, so the newline is typed
 * on its behalf — as an edit rather than a value swap, which leaves the caret
 * where the user put it and the newline undoable like any other keystroke.
 */
export const insertNewline = (textarea: HTMLTextAreaElement): void => {
  textarea.focus();
  document.execCommand('insertText', false, '\n');
};
