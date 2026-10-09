import { describe, expect, it } from 'vitest';
import { emptyHistory, pushHistory, undoHistory, redoHistory, mapUndoShortcut } from './mapUndo.js';

describe('map edit history', () => {
  it('restores distinct draft snapshots, preserves IDs and discards redo after a new edit', () => {
    const original = { nodes: [{ id: 'a', x: .1 }] }, moved = { nodes: [{ id: 'a', x: .2 }] }, deleted = { nodes: [] };
    let state = pushHistory(pushHistory(emptyHistory(original), moved), deleted);
    state = undoHistory(state); expect(state.present).toBe(moved);
    state = undoHistory(state); expect(state.present).toBe(original);
    state = redoHistory(state); expect(state.present.nodes).toEqual([{ id: 'a', x: .2 }]);
    state = pushHistory(state, { nodes: [{ id: 'a', x: .4 }] });
    expect(state.future).toEqual([]); expect(redoHistory(state)).toBe(state);
    expect(original.nodes[0].x).toBe(.1);
  });
  it('bounds history to 100 actions and leaves an empty stack unchanged', () => {
    let state = emptyHistory(0);
    expect(undoHistory(state)).toBe(state); expect(pushHistory(state, 0)).toBe(state);
    for (let i = 1; i <= 105; i++) state = pushHistory(state, i);
    expect(state.past).toHaveLength(100);
    for (let i = 0; i < 100; i++) state = undoHistory(state);
    expect(state.present).toBe(5); expect(state.future).toHaveLength(100);
  });
  it('supports Windows and macOS shortcuts while preserving input undo', () => {
    expect(mapUndoShortcut({ key: 'z', ctrlKey: true })).toBe('undo');
    expect(mapUndoShortcut({ key: 'Z', metaKey: true, shiftKey: true })).toBe('redo');
    expect(mapUndoShortcut({ key: 'y', ctrlKey: true })).toBe('redo');
    expect(mapUndoShortcut({ key: 'z', ctrlKey: true, altKey: true })).toBeNull();
    expect(mapUndoShortcut({ key: 'z' })).toBeNull();
    expect(mapUndoShortcut({ key: 'z', ctrlKey: true, target: { closest: () => ({}) } })).toBeNull();
  });
});
