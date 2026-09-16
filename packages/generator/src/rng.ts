/**
 * Seeded PRNG. Every random draw in the generator threads through one of these
 * — nothing else in the package may produce randomness, or determinism is gone.
 *
 * mulberry32: 32-bit integer arithmetic only, so it produces identical output
 * on every JS engine and platform.
 */
export interface Rng {
  /** Float in [0, 1). */
  float(): number;
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** One item from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** True with probability `p` (0–1). */
  chance(p: number): boolean;
}

export function createRng(seed: number): Rng {
  let state = seed | 0;

  const float = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (max < min) {
      throw new Error(`rng.int: max (${max}) is below min (${min})`);
    }
    return min + Math.floor(float() * (max - min + 1));
  };

  const pick = <T,>(items: readonly T[]): T => {
    const item = items[int(0, items.length - 1)];
    if (item === undefined) {
      throw new Error('rng.pick: called with an empty array');
    }
    return item;
  };

  const chance = (p: number): boolean => float() < p;

  return { float, int, pick, chance };
}
