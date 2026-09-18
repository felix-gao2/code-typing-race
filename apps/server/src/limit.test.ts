import { describe, expect, it } from 'vitest';
import { RateLimit } from './limit.ts';

describe('RateLimit', () => {
  it('allows up to the limit and refuses the one after', () => {
    const limit = new RateLimit(3, 1000);

    expect(limit.allow('a', 0)).toBe(true);
    expect(limit.allow('a', 100)).toBe(true);
    expect(limit.allow('a', 200)).toBe(true);
    expect(limit.allow('a', 300)).toBe(false);
  });

  it('keeps refusing for the rest of the window', () => {
    const limit = new RateLimit(1, 1000);
    limit.allow('a', 0);

    expect(limit.allow('a', 500)).toBe(false);
    expect(limit.allow('a', 999)).toBe(false);
  });

  it('opens a new window once the old one has passed', () => {
    const limit = new RateLimit(1, 1000);
    limit.allow('a', 0);

    expect(limit.allow('a', 1000)).toBe(true);
  });

  it('counts each key separately', () => {
    const limit = new RateLimit(1, 1000);
    limit.allow('a', 0);

    expect(limit.allow('b', 0)).toBe(true);
  });

  it('drops expired windows rather than growing forever', () => {
    const limit = new RateLimit(1, 1000);
    limit.allow('a', 0);
    limit.allow('b', 900);

    limit.sweep(1500);

    expect(limit.size).toBe(1);
  });

  it('does not drop a window that is still counting', () => {
    const limit = new RateLimit(1, 1000);
    limit.allow('a', 0);

    limit.sweep(999);

    expect(limit.allow('a', 999)).toBe(false);
  });
});
