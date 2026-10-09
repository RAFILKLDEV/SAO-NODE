import { describe, expect, it } from 'vitest';
import { beginPointerDrag, finishPointerDrag, updatePointerDrag } from './mapDrag.js';

describe('regional map pointer drag state', () => {
  it('does not commit a click without displacement', () => {
    const state = beginPointerDrag({ pointerId: 1, clientX: 10, clientY: 10, kind: 'marker' });
    const updated = updatePointerDrag(state, { pointerId: 1, clientX: 12, clientY: 12 }, { x: 0.5, y: 0.5 });
    expect(updated.changed).toBe(false);
    expect(finishPointerDrag(updated.state, 1).commit).toBeNull();
  });

  it('commits one preview after crossing the movement threshold', () => {
    const state = beginPointerDrag({ pointerId: 7, clientX: 10, clientY: 10, kind: 'marker' });
    const updated = updatePointerDrag(state, { pointerId: 7, clientX: 20, clientY: 20 }, { x: 0.2, y: 0.3 });
    expect(finishPointerDrag(updated.state, 7).commit).toEqual({ x: 0.2, y: 0.3 });
  });

  it('ignores a different pointer and supports cancellation by dropping the state', () => {
    const state = beginPointerDrag({ pointerId: 2, clientX: 0, clientY: 0, kind: 'pin' });
    expect(updatePointerDrag(state, { pointerId: 3, clientX: 20, clientY: 20 }, { x: 1, y: 1 }).changed).toBe(false);
    expect(finishPointerDrag(null, 2).commit).toBeNull();
  });
});
