import { describe, expect, it } from 'vitest';
import { ensureGifLoops } from '../src/routes/media.js';

const singleFrameGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

describe('image media', () => {
  it('adds an infinite loop extension to GIFs without one', () => {
    const result = ensureGifLoops(singleFrameGif);
    const marker = result.indexOf('NETSCAPE2.0', 0, 'ascii');
    expect(marker).toBeGreaterThan(0);
    expect([...result.subarray(marker + 11, marker + 15)]).toEqual([3, 1, 0, 0]);
  });

  it('changes a finite GIF loop count to infinite', () => {
    const finite = ensureGifLoops(singleFrameGif);
    const marker = finite.indexOf('NETSCAPE2.0', 0, 'ascii');
    finite[marker + 13] = 2;
    finite[marker + 14] = 0;
    const result = ensureGifLoops(finite);
    expect([...result.subarray(marker + 13, marker + 15)]).toEqual([0, 0]);
  });
});
