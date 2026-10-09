import { describe, expect, it } from 'vitest';
import { calibrateScale, insertSegmentPoint, measureDistance, midpoint, pinColor, scaleBar, simplifyBoundary } from './mapGeometry.js';

describe('mapGeometry', () => {
  it('maps every pin type to its color', () => {
    expect(pinColor('region')).toBe('#8b5cf6');
    expect(pinColor('location')).toBe('#2563eb');
    expect(pinColor('npc')).toBe('#16a34a');
    expect(pinColor('quest')).toBe('#eab308');
    expect(pinColor('monster')).toBe('#dc2626');
    expect(pinColor('item')).toBe('#f97316');
  });
  it('calibrates km per natural pixel and measures a route', () => {
    const scale = calibrateScale({ x: 0, y: 0 }, { x: 1, y: 0 }, 100, 1000, 500);
    expect(scale.kmPerPixel).toBeCloseTo(0.1);
    expect(measureDistance([{ x: 0, y: 0 }, { x: 0.5, y: 0 }], scale)).toBeCloseTo(50);
  });
  it('creates and inserts segment midpoints', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 1, y: 1 })).toEqual({ x: 0.5, y: 0.5 });
    expect(insertSegmentPoint([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], 1)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 }, { x: 1, y: 1 }]);
  });
  it('shows a readable scale bar whose width and kilometers agree at every display size', () => {
    const scale = calibrateScale({ x: 0.1, y: 0.2 }, { x: 0.6, y: 0.2 }, 40, 1600, 800);
    const bar = scaleBar(scale);
    expect(bar).toEqual({ distanceKm: 10, widthPercent: 12.5 });
    for (const displayedWidth of [1600, 800, 320]) {
      const barWidth = displayedWidth * bar.widthPercent / 100;
      expect(barWidth * scale.imageWidth / displayedWidth * scale.kmPerPixel).toBeCloseTo(bar.distanceKm);
    }
    expect(scaleBar(null)).toBeNull();
    expect(scaleBar({ imageWidth: 1000, kmPerPixel: 0 })).toBeNull();
  });
  it('preserves a freehand boundary shape while removing redundant points', () => {
    const points = [{ x: .1, y: .1 }, { x: .2, y: .1 }, { x: .4, y: .1 }, { x: .4, y: .4 }, { x: .1, y: .4 }];
    expect(simplifyBoundary(points)).toEqual([points[0], points[2], points[3], points[4]]);
    expect(simplifyBoundary(points.slice(0, 2))).toEqual(points.slice(0, 2));
  });
});
