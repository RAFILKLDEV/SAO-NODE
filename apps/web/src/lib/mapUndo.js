export const emptyHistory = present => ({ past: [], present, future: [] });
export const pushHistory = (history, present) => Object.is(history.present, present) ? history : ({ past: [...history.past, history.present].slice(-100), present, future: [] });
export const undoHistory = history => history.past.length ? ({ past: history.past.slice(0, -1), present: history.past.at(-1), future: [history.present, ...history.future].slice(0, 100) }) : history;
export const redoHistory = history => history.future.length ? ({ past: [...history.past, history.present].slice(-100), present: history.future[0], future: history.future.slice(1) }) : history;
export function mapUndoShortcut(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]')) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  return key === 'y' ? 'redo' : null;
}
