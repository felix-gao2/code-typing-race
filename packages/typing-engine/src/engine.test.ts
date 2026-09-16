import { describe, expect, it } from 'vitest';
import { isFinished, replay, start, step, type InputEvent } from './engine.ts';
import { mapTarget } from './target.ts';

const JAVA = ['int count = 5;', '', 'if (count >= 10) {', '    count -= 4;', '}'].join('\n');

/** The keystream a flawless run produces, one keystroke every 100ms. */
const perfect = (text: string, gap = 100): InputEvent[] =>
  mapTarget(text).chars.map((c, i) => ({ kind: 'char', char: c.char, at: (i + 1) * gap }));

const chars = (text: string, from = 100, gap = 100): InputEvent[] =>
  [...text].map((char, i) => ({ kind: 'char', char, at: from + i * gap }));

describe('a flawless run', () => {
  it('finishes, with every character correct', () => {
    const state = replay(JAVA, perfect(JAVA), 'permissive');
    expect(isFinished(state)).toBe(true);
    expect(state.chars.every((c) => c.status === 'correct')).toBe(true);
    expect(state.incorrectKeystrokes).toBe(0);
    expect(state.correctKeystrokes).toBe(state.chars.length);
  });

  it('never asks for the indentation', () => {
    // The body line is typed as `count -= 4;`, with no leading spaces.
    const state = replay(JAVA, perfect(JAVA), 'permissive');
    const typed = perfect(JAVA)
      .map((e) => (e.kind === 'char' ? e.char : ''))
      .join('');
    expect(typed).not.toContain('    ');
    expect(state.finishedAt).toBe(state.chars.length * 100);
  });

  it('starts the clock on the first keystroke, not at zero', () => {
    const state = replay(JAVA, perfect(JAVA), 'permissive');
    expect(state.startedAt).toBe(100);
  });
});

describe('permissive mode', () => {
  it('takes a wrong character and moves on', () => {
    const state = replay('ab', chars('xb'), 'permissive');
    expect(state.chars[0]).toStrictEqual({ status: 'wrong', everWrong: true });
    expect(state.chars[1]).toStrictEqual({ status: 'correct', everWrong: false });
    expect(isFinished(state)).toBe(true);
    expect(state.incorrectKeystrokes).toBe(1);
  });

  it('lets backspace undo a character without forgiving it', () => {
    const events: InputEvent[] = [
      { kind: 'char', char: 'x', at: 100 },
      { kind: 'backspace', at: 200 },
      { kind: 'char', char: 'a', at: 300 },
      { kind: 'char', char: 'b', at: 400 },
    ];
    const state = replay('ab', events, 'permissive');
    expect(isFinished(state)).toBe(true);
    // Fixed on the page, still paid for in the keystroke counts.
    expect(state.chars[0]).toStrictEqual({ status: 'correct', everWrong: true });
    expect(state.correctKeystrokes).toBe(2);
    expect(state.incorrectKeystrokes).toBe(1);
  });

  it('treats Enter typed mid-line as an ordinary wrong character', () => {
    const state = replay('ab\ncd', chars('a\n'), 'permissive');
    expect(state.chars[1]).toStrictEqual({ status: 'wrong', everWrong: true });
    expect(state.cursor).toBe(2);
  });
});

describe('blocking mode', () => {
  it('holds the caret until the right key arrives', () => {
    const state = replay('ab', chars('xxx'), 'blocking');
    expect(state.cursor).toBe(0);
    expect(state.incorrectKeystrokes).toBe(3);
    expect(isFinished(state)).toBe(false);
  });

  it('records that a position was fumbled even though it never shows wrong', () => {
    const state = replay('ab', chars('xab'), 'blocking');
    expect(state.chars[0]).toStrictEqual({ status: 'correct', everWrong: true });
    expect(isFinished(state)).toBe(true);
  });

  it('cannot be finished by typing the wrong thing forever', () => {
    const state = replay('ab', chars('x'.repeat(50)), 'blocking');
    expect(isFinished(state)).toBe(false);
    expect(state.finishedAt).toBeUndefined();
  });
});

describe('the same keystream under each mode', () => {
  // Against `abc`: permissive spends the wrong `x` on position 1 and the `c`
  // lands on position 2, finishing the run. Blocking refuses the `x`, so the
  // `c` is then offered to position 1 and refused too.
  const events = chars('axc');

  it('diverges exactly where the flag says it should', () => {
    const permissive = replay('abc', events, 'permissive');
    const blocking = replay('abc', events, 'blocking');

    expect(permissive.chars[1]?.status).toBe('wrong');
    expect(isFinished(permissive)).toBe(true);
    expect(permissive.incorrectKeystrokes).toBe(1);

    expect(blocking.cursor).toBe(1);
    expect(isFinished(blocking)).toBe(false);
    expect(blocking.incorrectKeystrokes).toBe(2);
  });
});

describe('rejected keystreams', () => {
  it('refuses a target with nothing to type', () => {
    expect(() => start('', 'permissive')).toThrow(/no typeable characters/);
    expect(() => start('\n\n   \n', 'permissive')).toThrow(/no typeable characters/);
  });

  it('refuses an event that arrives before the one before it', () => {
    const events: InputEvent[] = [
      { kind: 'char', char: 'a', at: 500 },
      { kind: 'char', char: 'b', at: 400 },
    ];
    expect(() => replay('ab', events, 'permissive')).toThrow(/before the previous event/);
  });

  it('allows two keystrokes on the same millisecond', () => {
    const events: InputEvent[] = [
      { kind: 'char', char: 'a', at: 500 },
      { kind: 'char', char: 'b', at: 500 },
    ];
    expect(isFinished(replay('ab', events, 'permissive'))).toBe(true);
  });

  it('refuses a non-finite timestamp', () => {
    expect(() => replay('ab', [{ kind: 'char', char: 'a', at: NaN }], 'permissive')).toThrow(
      /finite/,
    );
  });

  it('refuses events after the run is over', () => {
    const done = replay('ab', chars('ab'), 'permissive');
    expect(() => step(done, { kind: 'char', char: 'c', at: 9000 })).toThrow(/already finished/);
  });
});

describe('backspace at the start of a run', () => {
  const events: InputEvent[] = [
    { kind: 'backspace', at: 50 },
    { kind: 'char', char: 'a', at: 100 },
  ];

  it('does nothing and does not start the clock', () => {
    const state = replay('ab', events, 'permissive');
    expect(state.cursor).toBe(1);
    expect(state.startedAt).toBe(100);
    expect(state.correctKeystrokes).toBe(1);
    expect(state.incorrectKeystrokes).toBe(0);
  });
});

describe('purity', () => {
  it('does not mutate the state it was given', () => {
    const before = start('ab', 'permissive');
    const snapshot = JSON.stringify(before);
    step(before, { kind: 'char', char: 'a', at: 100 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('produces an identical state when the same stream is replayed', () => {
    const events = chars('axc');
    expect(replay('abc', events, 'permissive')).toStrictEqual(replay('abc', events, 'permissive'));
  });
});
