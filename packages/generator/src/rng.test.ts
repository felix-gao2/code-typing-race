import { describe, expect, it } from 'vitest';
import { createRng } from './rng.ts';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const drawA = Array.from({ length: 200 }, () => a.float());
    const drawB = Array.from({ length: 200 }, () => b.float());
    expect(drawA).toEqual(drawB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const drawA = Array.from({ length: 50 }, () => a.float());
    const drawB = Array.from({ length: 50 }, () => b.float());
    expect(drawA).not.toEqual(drawB);
  });

  it('pins known output, so a change to the algorithm is deliberate', () => {
    const rng = createRng(1);
    expect([rng.float(), rng.float(), rng.float()]).toMatchInlineSnapshot(`
      [
        0.6270739405881613,
        0.002735721180215478,
        0.5274470399599522,
      ]
    `);
  });

  it('stays inside int bounds, including single-value ranges', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.int(3, 9);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(9);
      expect(Number.isInteger(value)).toBe(true);
    }
    expect(rng.int(4, 4)).toBe(4);
  });

  it('reaches both ends of a range', () => {
    const rng = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      seen.add(rng.int(0, 2));
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it('throws rather than returning undefined for an empty pick', () => {
    expect(() => createRng(1).pick([])).toThrow(/empty array/);
  });

  it('throws when the range is inverted', () => {
    expect(() => createRng(1).int(5, 2)).toThrow(/below min/);
  });
});
