import type { RaceConfig } from '@ctr/race-machine';
import { mapTarget, type InputEvent } from '@ctr/typing-engine';
import { describe, expect, it } from 'vitest';
import { verify, viewOf } from './io.ts';
import { Rooms, type Room, type RoomRequest } from './rooms.ts';

const CONFIG: RaceConfig = {
  minRacers: 2,
  maxRacers: 4,
  countdownMs: 3000,
  raceTimeoutMs: 60_000,
};

const REQUEST: RoomRequest = { language: 'java', lines: 10, config: CONFIG };

function room(): Room {
  return new Rooms().open(REQUEST, 0);
}

/**
 * A flawless run of the room's snippet at a fixed cadence, built from the
 * engine's own flattening rather than a second guess at it — leading
 * whitespace is never typed and a blank line is crossed by the same Enter
 * that ends the line before it.
 */
function perfectRun(text: string, msPerKey = 100): InputEvent[] {
  let at = 1000;
  return mapTarget(text).chars.map((typeable) => ({
    kind: 'char' as const,
    char: typeable.char,
    at: (at += msPerKey),
  }));
}

describe('verify', () => {
  it('recomputes a clean run from its keystream', () => {
    const target = room();
    const result = verify(target, 'a', { events: perfectRun(target.state.text) });

    expect(result.metrics.accuracy).toBe(1);
    expect(result.metrics.errors).toBe(0);
    expect(result.metrics.progress).toBe(1);
    expect(result.metrics.wpm).toBeGreaterThan(0);
  });

  it('measures a slower run as slower', () => {
    const target = room();
    const quick = verify(target, 'a', { events: perfectRun(target.state.text, 60) });
    const slow = verify(target, 'a', { events: perfectRun(target.state.text, 240) });
    expect(slow.metrics.wpm).toBeLessThan(quick.metrics.wpm);
  });

  it('carries the versions and the snippet identity with the result', () => {
    const target = room();
    const result = verify(target, 'a', { events: perfectRun(target.state.text) });

    // A stored run must always be able to say which rules produced it.
    expect(result.generatorVersion).toBe(3);
    expect(result.engineVersion).toBe(1);
    expect(result.engineMode).toBe('permissive');
    expect(result.seed).toBe(target.seed);
    expect(result.language).toBe('java');
    expect(result.lines).toBe(10);
    expect(result.racerId).toBe('a');
  });

  /**
   * The point of submitting a keystream rather than a number: a client cannot
   * simply claim a time.
   */
  it('refuses a keystream that never finishes the snippet', () => {
    const target = room();
    const truncated = perfectRun(target.state.text).slice(0, 5);
    expect(() => verify(target, 'a', { events: truncated })).toThrow(/does not finish/);
  });

  it('refuses an empty keystream', () => {
    expect(() => verify(room(), 'a', { events: [] })).toThrow(/does not finish/);
  });

  it('refuses a keystream for a different snippet', () => {
    const mine = room();
    const theirs = room();
    // Two rooms draw different seeds, so one snippet's keystream cannot
    // complete the other's.
    expect(() => verify(mine, 'a', { events: perfectRun(theirs.state.text) })).toThrow();
  });

  it('refuses a keystream whose timestamps run backwards', () => {
    const target = room();
    const events = perfectRun(target.state.text);
    const forged = events.map((event, index) =>
      index === events.length - 1 ? { ...event, at: 0 } : event,
    );
    // Sorting this would launder exactly the forgery that recomputing exists
    // to catch, so the engine throws instead.
    expect(() => verify(target, 'a', { events: forged })).toThrow();
  });

  it('charges a corrected mistake to accuracy but still completes', () => {
    const target = room();
    const clean = perfectRun(target.state.text);
    const [first, ...rest] = clean;
    if (first === undefined || first.kind !== 'char') {
      throw new Error('expected the run to open with a character');
    }
    const wrong = first.char === 'x' ? 'y' : 'x';
    const sloppy: InputEvent[] = [
      { kind: 'char', char: wrong, at: first.at - 2 },
      { kind: 'backspace', at: first.at - 1 },
      first,
      ...rest,
    ];

    const result = verify(target, 'a', { events: sloppy });
    expect(result.metrics.progress).toBe(1);
    expect(result.metrics.accuracy).toBeLessThan(1);
    expect(result.metrics.errors).toBeGreaterThan(0);
  });
});

describe('viewOf', () => {
  it('shows the racers and the snippet', () => {
    const rooms = new Rooms();
    const target = rooms.open(REQUEST, 0);
    rooms.dispatch(target.id, { type: 'join', id: 'a', at: 0 });

    const view = viewOf(target);
    expect(view.id).toBe(target.id);
    expect(view.kind).toBe('private');
    expect(view.phase).toBe('waiting');
    expect(view.text).toBe(target.state.text);
    expect(view.racers).toEqual([{ id: 'a', progress: 0, connected: true, finishedAt: undefined }]);
  });

  it('carries nothing a client should not have', () => {
    const view = viewOf(room()) as unknown as Record<string, unknown>;
    // The keystream and the seed stay on the server: the seed would let a
    // client pre-generate and pre-type the snippet.
    expect(view.seed).toBeUndefined();
    expect(view.events).toBeUndefined();
  });
});
