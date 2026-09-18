import { generateSnippet } from '@ctr/generator';
import { mapTarget, type InputEvent } from '@ctr/typing-engine';
import { describe, expect, it } from 'vitest';
import { parseSolo, verifySolo } from './runs.ts';

const PLAYER = { id: 'p1', name: 'felix' };

function perfectRun(text: string, msPerKey = 100): InputEvent[] {
  let at = 1000;
  return mapTarget(text).chars.map((typeable) => ({
    kind: 'char' as const,
    char: typeable.char,
    at: (at += msPerKey),
  }));
}

function submission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = { language: 'java', lines: 10, seed: 7 };
  const text = generateSnippet({ seed: 7, language: 'java', lines: 10 });
  return { ...base, player: PLAYER, events: perfectRun(text), ...overrides };
}

describe('parseSolo', () => {
  it('accepts a well-formed submission', () => {
    expect(parseSolo(submission()).seed).toBe(7);
  });

  it('refuses a language the generator does not have', () => {
    expect(() => parseSolo(submission({ language: 'cobol' }))).toThrow(/language must be one of/);
  });

  it('refuses a line count outside the range', () => {
    expect(() => parseSolo(submission({ lines: 0 }))).toThrow(/lines/);
    expect(() => parseSolo(submission({ lines: 201 }))).toThrow(/lines/);
    expect(() => parseSolo(submission({ lines: 10.5 }))).toThrow(/lines/);
  });

  it('refuses a seed that is not a 32-bit non-negative integer', () => {
    expect(() => parseSolo(submission({ seed: -1 }))).toThrow(/seed/);
    expect(() => parseSolo(submission({ seed: 2 ** 32 }))).toThrow(/seed/);
  });

  it('refuses an empty keystream, which is not a run of anything', () => {
    expect(() => parseSolo(submission({ events: [] }))).toThrow(/non-empty/);
  });

  it('refuses a keystream long enough to be a flood', () => {
    const flood = Array.from({ length: 20_001 }, (_, i) => ({ kind: 'char', char: 'a', at: i }));
    expect(() => parseSolo(submission({ events: flood }))).toThrow(/at most/);
  });

  it('refuses events that are not keystrokes', () => {
    expect(() => parseSolo(submission({ events: [{ kind: 'char', at: 1 }] }))).toThrow(
      /keystrokes/,
    );
  });

  it('refuses a submission with no player id', () => {
    expect(() => parseSolo(submission({ player: { name: 'felix' } }))).toThrow(/player/);
    expect(() => parseSolo(submission({ player: { id: '', name: 'felix' } }))).toThrow(/player/);
  });

  it('allows a player with no name at all', () => {
    expect(parseSolo(submission({ player: { id: 'p1' } })).player.id).toBe('p1');
  });

  /**
   * A board query coerces its numbers because a query string has none; a JSON
   * body has them, so a string here is a client sending the wrong thing.
   */
  it('does not coerce a body the way a query string is coerced', () => {
    expect(() => parseSolo(submission({ seed: '7' }))).toThrow(/seed/);
    expect(() => parseSolo(submission({ lines: '10' }))).toThrow(/lines/);
  });

  it('drops a reported result rather than carrying it into the recomputation', () => {
    const parsed = parseSolo(submission({ wpm: 999, accuracy: 1 }));

    expect(parsed).not.toHaveProperty('wpm');
    expect(Object.keys(parsed).sort()).toStrictEqual([
      'events',
      'language',
      'lines',
      'player',
      'seed',
    ]);
  });
});

describe('verifySolo', () => {
  it('recomputes a clean run from the snippet it regenerates itself', () => {
    const result = verifySolo(parseSolo(submission()));

    expect(result.metrics.accuracy).toBe(1);
    expect(result.metrics.wpm).toBeGreaterThan(0);
    expect(result.seed).toBe(7);
  });

  it('refuses a keystream that does not finish the snippet', () => {
    const short = perfectRun(generateSnippet({ seed: 7, language: 'java', lines: 10 })).slice(0, 5);

    expect(() => verifySolo(parseSolo(submission({ events: short })))).toThrow(/does not finish/);
  });

  it('scores a keystream typed against a different snippet as the mess it is', () => {
    // Permissive mode does not block on a wrong character, so another
    // snippet's keystream can reach the end — it just did not type this text.
    // Nothing has to refuse it: every wrong character is charged to accuracy,
    // and a run cannot be made fast by sending the wrong keys.
    const mine = mapTarget(generateSnippet({ seed: 7, language: 'java', lines: 10 })).chars;
    const theirs = mapTarget(generateSnippet({ seed: 8, language: 'java', lines: 10 })).chars;
    // Cycled rather than sliced to exactly the length this snippet wants: the
    // other snippet is not guaranteed to be the longer of the two, and a
    // keystream that stops short would be refused for finishing nothing
    // instead of scored for typing the wrong thing.
    let at = 1000;
    const other = mine.map((_, index) => ({
      kind: 'char' as const,
      char: theirs[index % theirs.length]?.char ?? 'x',
      at: (at += 100),
    }));
    const result = verifySolo(parseSolo(submission({ events: other })));

    expect(result.metrics.accuracy).toBeLessThan(1);
  });

  it('refuses a keystream longer than the snippet rather than throwing at the engine', () => {
    const mine = generateSnippet({ seed: 7, language: 'java', lines: 10 });
    const tooMany = [...perfectRun(mine), { kind: 'char' as const, char: 'x', at: 10_000_000 }];

    expect(() => verifySolo(parseSolo(submission({ events: tooMany })))).toThrow(
      /not a run of this snippet/,
    );
  });

  it('ranks the presets and nothing else', () => {
    for (const lines of [10, 20, 35]) {
      const text = generateSnippet({ seed: 7, language: 'java', lines });
      expect(verifySolo(parseSolo(submission({ lines, events: perfectRun(text) }))).ranked).toBe(
        true,
      );
    }
    const custom = generateSnippet({ seed: 7, language: 'java', lines: 17 });
    expect(
      verifySolo(parseSolo(submission({ lines: 17, events: perfectRun(custom) }))).ranked,
    ).toBe(false);
  });
});
