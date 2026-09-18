import { describe, expect, it } from 'vitest';
import { ANONYMOUS, cleanName, NAME_MAX } from './player.ts';

describe('cleanName', () => {
  it('keeps letters, digits and separators from any script', () => {
    expect(cleanName('felix_2 gao-1')).toBe('felix_2 gao-1');
    expect(cleanName('ゆうき')).toBe('ゆうき');
  });

  it('strips what would wreck a row of a leaderboard', () => {
    expect(cleanName('fe‮lix')).toBe('felix');
    expect(cleanName('a​b')).toBe('ab');
    expect(cleanName('nice 🙂 name')).toBe('nice name');
  });

  it('collapses runs of whitespace and trims the ends', () => {
    expect(cleanName('  felix   gao \n')).toBe('felix gao');
  });

  it('truncates to the limit without leaving a trailing space', () => {
    const long = cleanName('a'.repeat(NAME_MAX + 10));
    expect(long).toHaveLength(NAME_MAX);
    expect(cleanName(`${'a'.repeat(NAME_MAX - 1)} bcd`)).toBe('a'.repeat(NAME_MAX - 1));
  });

  it('falls back rather than producing an empty name', () => {
    expect(cleanName('')).toBe(ANONYMOUS);
    expect(cleanName('   ')).toBe(ANONYMOUS);
    expect(cleanName('🙂🙂')).toBe(ANONYMOUS);
  });
});
