import { describe, expect, it } from 'vitest';
import { isOutsideSurface } from './useOutsideDismiss.js';

describe('outside dismissal boundaries', () => {
  const child = {};
  const outside = {};
  const panel = { contains: target => target === child };
  const dialog = {
    ...panel, tagName: 'DIALOG', open: true,
    getBoundingClientRect: () => ({ left: 100, right: 400, top: 80, bottom: 300 })
  };

  it('keeps content and shadow children open, dismissing only outside', () => {
    expect(isOutsideSurface({ target: child }, panel)).toBe(false);
    expect(isOutsideSurface({ target: outside, composedPath: () => [outside, panel] }, panel)).toBe(false);
    expect(isOutsideSurface({ target: outside }, panel)).toBe(true);
    expect(isOutsideSurface({ target: outside }, null)).toBe(false);
  });

  it.each([[99, 150], [401, 150], [150, 79], [150, 301]])('recognizes native backdrop at %s,%s despite targeting the dialog', (clientX, clientY) => {
    expect(isOutsideSurface({ target: dialog, clientX, clientY }, dialog)).toBe(true);
  });

  it('keeps native padding and closed dialogs from dismissing', () => {
    expect(isOutsideSurface({ target: dialog, clientX: 120, clientY: 90 }, dialog)).toBe(false);
    expect(isOutsideSurface({ target: child }, dialog)).toBe(false);
    expect(isOutsideSurface({ target: outside }, { ...dialog, open: false })).toBe(false);
  });
});
