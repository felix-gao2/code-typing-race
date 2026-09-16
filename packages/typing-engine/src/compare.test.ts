import { describe, expect, it } from 'vitest';
import { advances, compare, type EngineMode } from './compare.ts';

const MODES: EngineMode[] = ['permissive', 'blocking'];

describe('compare', () => {
  it.each(MODES)('accepts a match in %s mode', (mode) => {
    expect(compare('c', 'c', mode)).toBe('correct');
    expect(compare('\n', '\n', mode)).toBe('correct');
  });

  it('takes a wrong character in permissive mode', () => {
    expect(compare('c', 'x', 'permissive')).toBe('wrong');
  });

  it('refuses a wrong character in blocking mode', () => {
    expect(compare('c', 'x', 'blocking')).toBe('rejected');
  });

  it('treats Enter mid-line as an ordinary mismatch, not a special case', () => {
    expect(compare('c', '\n', 'permissive')).toBe('wrong');
    expect(compare('c', '\n', 'blocking')).toBe('rejected');
  });

  it('treats a character typed where Enter is expected the same way', () => {
    expect(compare('\n', 'x', 'permissive')).toBe('wrong');
    expect(compare('\n', 'x', 'blocking')).toBe('rejected');
  });

  it('is case sensitive', () => {
    expect(compare('c', 'C', 'permissive')).toBe('wrong');
  });

  it('does not treat a space as interchangeable with a line break', () => {
    expect(compare('\n', ' ', 'permissive')).toBe('wrong');
    expect(compare(' ', '\n', 'permissive')).toBe('wrong');
  });
});

describe('advances', () => {
  it('moves the caret on anything the run took', () => {
    expect(advances('correct')).toBe(true);
    expect(advances('wrong')).toBe(true);
  });

  it('holds the caret on a refusal', () => {
    expect(advances('rejected')).toBe(false);
  });
});
