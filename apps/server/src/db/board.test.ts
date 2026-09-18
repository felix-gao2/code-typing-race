import { describe, expect, it } from 'vitest';
import { parseBoardQuery, startOfDay } from './board.ts';

const NOW = new Date('2026-09-18T14:32:07.123Z');

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: 'solo', language: 'java', lines: '20', ...overrides };
}

describe('startOfDay', () => {
  it('is midnight UTC, so one day means the same thing everywhere', () => {
    expect(startOfDay(NOW).toISOString()).toBe('2026-09-18T00:00:00.000Z');
  });
});

describe('parseBoardQuery', () => {
  it('reads a board request', () => {
    expect(parseBoardQuery(params(), NOW)).toStrictEqual({
      kind: 'solo',
      language: 'java',
      lines: 20,
    });
  });

  it('refuses a board that is neither of the two', () => {
    expect(() => parseBoardQuery(params({ kind: 'both' }), NOW)).toThrow(/solo or multiplayer/);
    expect(() => parseBoardQuery(params({ kind: undefined }), NOW)).toThrow(/solo or multiplayer/);
  });

  it('refuses a language the generator does not have', () => {
    expect(() => parseBoardQuery(params({ language: 'cobol' }), NOW)).toThrow(/language/);
  });

  it('refuses a length with no board of its own', () => {
    expect(() => parseBoardQuery(params({ lines: '17' }), NOW)).toThrow(/lines must be one of/);
    expect(() => parseBoardQuery(params({ lines: 'twenty' }), NOW)).toThrow(/lines must be one of/);
  });

  it('accepts each preset', () => {
    for (const lines of ['10', '20', '35']) {
      expect(parseBoardQuery(params({ lines }), NOW).lines).toBe(Number(lines));
    }
  });

  it('bounds a daily board at midnight and leaves all-time unbounded', () => {
    expect(parseBoardQuery(params({ span: 'daily' }), NOW).since).toStrictEqual(startOfDay(NOW));
    expect(parseBoardQuery(params({ span: 'all-time' }), NOW).since).toBeUndefined();
    expect(parseBoardQuery(params(), NOW).since).toBeUndefined();
  });

  it('refuses a span that is neither', () => {
    expect(() => parseBoardQuery(params({ span: 'weekly' }), NOW)).toThrow(/span/);
  });
});
