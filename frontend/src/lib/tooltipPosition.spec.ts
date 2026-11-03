import { describe, expect, it } from 'vitest';
import { tooltipPosition } from './tooltipPosition';

describe('embedded tooltip positioning', () => {
  const surface = { left: 280, top: 52, width: 1000, height: 700 };
  const anchor = { left: 900, top: 96, width: 28, height: 28 };
  const bubble = { width: 84, height: 28 };
  it('aligns with the hovered icon in a surface offset by a host sidebar and header', () => {
    const result = tooltipPosition(anchor, surface, bubble);
    expect(result.x).toBe(634);
    expect(result.y).toBe(78);
    expect(result.x + surface.left).toBe(anchor.left + anchor.width / 2);
    expect(result.y + surface.top).toBe(anchor.top + anchor.height + 6);
    expect(result.above).toBe(false);
  });
  it('keeps the same local position when the host sidebar moves the entire surface', () => {
    expect(tooltipPosition({ ...anchor, left: anchor.left + 120 }, { ...surface, left: 400 }, bubble))
      .toEqual(tooltipPosition(anchor, surface, bubble));
  });
  it('clamps the entire bubble at either surface edge while keeping its arrow on the icon', () => {
    for (const left of [surface.left, surface.left + surface.width - 28]) {
      const result = tooltipPosition({ ...anchor, left }, surface, bubble);
      expect(result.x - bubble.width / 2).toBeGreaterThanOrEqual(8);
      expect(result.x + bubble.width / 2).toBeLessThanOrEqual(surface.width - 8);
      expect(result.x + result.arrowOffset + surface.left).toBe(left + anchor.width / 2);
    }
  });
  it('uses the surface height to flip above the icon and limits text width in narrow panes', () => {
    const result = tooltipPosition({ left: 450, top: 700, width: 28, height: 28 }, { ...surface, width: 200 }, { width: 260, height: 42 });
    expect(result.above).toBe(true);
    expect(result.y).toBe(642);
    expect(result.maxWidth).toBe(184);
    expect(result.x).toBe(100);
  });
});
