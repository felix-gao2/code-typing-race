import { describe, expect, it } from 'vitest';
import { replay, start, step, type InputEvent } from './engine.ts';
import { measure } from './metrics.ts';
import { mapTarget } from './target.ts';

/** 50 characters, so the arithmetic is checkable by hand: 50 chars = 10 words. */
const TARGET = 'count += 1; count += 2; count += 3; count += 4;abc';

const perfect = (text: string, gap: number): InputEvent[] =>
  mapTarget(text).chars.map((c, i) => ({ kind: 'char', char: c.char, at: (i + 1) * gap }));

describe('wpm', () => {
  it('is characters over five per minute', () => {
    expect(TARGET).toHaveLength(50);
    // 49 gaps of 1000ms between the first and last of 50 keystrokes.
    const result = measure(replay(TARGET, perfect(TARGET, 1000), 'permissive'));
    expect(result.elapsedMs).toBe(49_000);
    expect(result.wpm).toBeCloseTo((50 / 5 / 49) * 60, 6);
  });

  it('doubles when the same run is typed twice as fast', () => {
    const slow = measure(replay(TARGET, perfect(TARGET, 1000), 'permissive'));
    const fast = measure(replay(TARGET, perfect(TARGET, 500), 'permissive'));
    expect(fast.wpm).toBeCloseTo(slow.wpm * 2, 6);
  });

  it('does not count a character that is still wrong at the end', () => {
    const events: InputEvent[] = [
      { kind: 'char', char: 'x', at: 1000 },
      { kind: 'char', char: 'b', at: 2000 },
      { kind: 'char', char: 'c', at: 3000 },
    ];
    const result = measure(replay('abc', events, 'permissive'));
    expect(result.wpm).toBeCloseTo((2 / 5 / 2) * 60, 6);
  });

  it('does count a character that was fixed, and charges accuracy instead', () => {
    const events: InputEvent[] = [
      { kind: 'char', char: 'x', at: 1000 },
      { kind: 'backspace', at: 1500 },
      { kind: 'char', char: 'a', at: 2000 },
      { kind: 'char', char: 'b', at: 3000 },
      { kind: 'char', char: 'c', at: 4000 },
    ];
    const result = measure(replay('abc', events, 'permissive'));
    expect(result.wpm).toBeCloseTo((3 / 5 / 3) * 60, 6);
    expect(result.accuracy).toBeCloseTo(3 / 4, 6);
  });

  it('is zero rather than infinite when no time has passed', () => {
    const events: InputEvent[] = [...'abc'].map((char) => ({ kind: 'char' as const, char, at: 0 }));
    const result = measure(replay('abc', events, 'permissive'));
    expect(result.elapsedMs).toBe(0);
    expect(result.wpm).toBe(0);
  });

  it('never counts the indentation that was never typed', () => {
    const indented = 'if (x) {\n    y += 1;\n}';
    const flat = mapTarget(indented).chars.length;
    expect(flat).toBe(indented.replace(/\n {4}/g, '\n').length);
    const result = measure(replay(indented, perfect(indented, 1000), 'permissive'));
    expect(result.wpm).toBeCloseTo((flat / 5 / (flat - 1)) * 60, 6);
  });
});

describe('accuracy', () => {
  it('is correct keystrokes over all keystrokes', () => {
    const result = measure(replay('abc', [...'xbc'].map(charAt), 'permissive'));
    expect(result.accuracy).toBeCloseTo(2 / 3, 6);
    expect(result.errors).toBe(1);
  });

  it('counts every refused keystroke in blocking mode', () => {
    const result = measure(replay('abc', [...'xxabc'].map(charAt), 'blocking'), 9000);
    expect(result.accuracy).toBeCloseTo(3 / 5, 6);
  });

  it('does not treat backspace as a keystroke', () => {
    const events: InputEvent[] = [
      { kind: 'char', char: 'a', at: 1000 },
      { kind: 'backspace', at: 2000 },
      { kind: 'char', char: 'a', at: 3000 },
      { kind: 'char', char: 'b', at: 4000 },
      { kind: 'char', char: 'c', at: 5000 },
    ];
    // Four correct keystrokes, none wrong — backspacing a correct character is
    // wasted time, not an error.
    expect(measure(replay('abc', events, 'permissive')).accuracy).toBe(1);
  });

  it('is a perfect score for a run that has not been typed yet', () => {
    expect(measure(start('abc', 'permissive'), 0).accuracy).toBe(1);
  });
});

describe('progress', () => {
  it('tracks the caret, not the clock', () => {
    let state = start('abc', 'permissive');
    expect(measure(state, 0).progress).toBe(0);
    state = step(state, { kind: 'char', char: 'a', at: 100 });
    expect(measure(state, 200).progress).toBeCloseTo(1 / 3, 6);
    state = step(state, { kind: 'char', char: 'b', at: 300 });
    state = step(state, { kind: 'char', char: 'c', at: 400 });
    expect(measure(state).progress).toBe(1);
  });

  it('advances on a wrong character in permissive mode', () => {
    const state = replay('abc', [charAt('x', 0)], 'permissive');
    expect(measure(state, 100).progress).toBeCloseTo(1 / 3, 6);
  });

  it('stays put on a wrong character in blocking mode', () => {
    const state = replay('abc', [charAt('x', 0)], 'blocking');
    expect(measure(state, 100).progress).toBe(0);
  });
});

describe('measuring an unfinished run', () => {
  it('refuses to guess the time', () => {
    const state = replay('abc', [charAt('a', 0)], 'permissive');
    expect(() => measure(state)).toThrow(/needs the current time/);
  });

  it('uses the finish time rather than now once the run is over', () => {
    const done = replay('abc', [...'abc'].map(charAt), 'permissive');
    expect(measure(done, 999_999).elapsedMs).toBe(measure(done).elapsedMs);
  });
});

function charAt(char: string, index = 0): InputEvent {
  return { kind: 'char', char, at: (index + 1) * 1000 };
}
