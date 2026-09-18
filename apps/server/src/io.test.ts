import type { RaceConfig } from '@ctr/race-machine';
import { mapTarget, type InputEvent } from '@ctr/typing-engine';
import { describe, expect, it } from 'vitest';
import { runRecordOf, snippetOf, verify, viewOf } from './io.ts';
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
    expect(result.generatorVersion).toBe(4);
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

/**
 * Three conditions, each of which alone disqualifies a result. This is the
 * rule that decides what a leaderboard is a record of.
 */
describe('ranked', () => {
  const PUBLIC: RaceConfig = { ...CONFIG, waitTimeoutMs: 10_000 };

  /** A public room whose race started with `racers` people. */
  function startedPublic(racers: number, lines = 10): Room {
    const rooms = new Rooms();
    const target = rooms.open({ language: 'java', lines, config: PUBLIC, kind: 'public' }, 0);
    for (let i = 0; i < racers; i += 1) {
      rooms.dispatch(target.id, { type: 'join', id: `r${i}`, at: 0 });
    }
    // Either minRacers or the wait timeout gets it counting; both then need
    // the countdown to elapse.
    rooms.advance(target.id, PUBLIC.waitTimeoutMs ?? 0);
    rooms.advance(target.id, (PUBLIC.waitTimeoutMs ?? 0) + PUBLIC.countdownMs);
    return target;
  }

  it('ranks a public race that two people started, at a preset length', () => {
    const target = startedPublic(2);
    expect(target.state.startedWith).toBe(2);
    expect(verify(target, 'r0', { events: perfectRun(target.state.text) }).ranked).toBe(true);
  });

  it('does not rank a race one person started', () => {
    const target = startedPublic(1);
    expect(target.state.startedWith).toBe(1);
    // Playable, and a real run — just not a race.
    const result = verify(target, 'r0', { events: perfectRun(target.state.text) });
    expect(result.ranked).toBe(false);
    expect(result.metrics.progress).toBe(1);
  });

  it('does not rank a private room, however many raced', () => {
    const rooms = new Rooms();
    const target = rooms.open(REQUEST, 0);
    rooms.dispatch(target.id, { type: 'join', id: 'a', at: 0 });
    rooms.dispatch(target.id, { type: 'join', id: 'b', at: 0 });
    rooms.advance(target.id, CONFIG.countdownMs);

    expect(target.state.startedWith).toBe(2);
    expect(verify(target, 'a', { events: perfectRun(target.state.text) }).ranked).toBe(false);
  });

  it('does not rank a custom length', () => {
    const target = startedPublic(2, 17);
    expect(verify(target, 'r0', { events: perfectRun(target.state.text) }).ranked).toBe(false);
  });

  it('ranks each of the three presets', () => {
    for (const lines of [10, 20, 35]) {
      const target = startedPublic(2, lines);
      expect(verify(target, 'r0', { events: perfectRun(target.state.text) }).ranked).toBe(true);
    }
  });
});

describe('runRecordOf', () => {
  const result = (() => {
    const target = room();
    return verify(target, 'a', { events: perfectRun(target.state.text) });
  })();

  it('cleans the name the client sent, which is the one field it chooses', () => {
    const record = runRecordOf(result, { id: 'p1', name: '  fe‮lix 🙂  ' }, 5000, 'race-1');

    expect(record.playerName).toBe('felix');
  });

  it('never stores an empty name', () => {
    expect(runRecordOf(result, { id: 'p1', name: '   ' }, 5000).playerName).toBe('anon');
  });

  it('names a player who sent no name at all, rather than refusing the run', () => {
    expect(runRecordOf(result, { id: 'p1' }, 5000).playerName).toBe('anon');
  });

  it('leaves a solo run with no race, so the two boards cannot mix', () => {
    expect(runRecordOf(result, { id: 'p1', name: 'felix' }, 5000).raceId).toBeUndefined();
  });

  it('carries the result the server computed, not anything a client said', () => {
    const record = runRecordOf(result, { id: 'p1', name: 'felix' }, 5000, 'race-1');

    expect(record.wpm).toBe(result.metrics.wpm);
    expect(record.accuracy).toBe(1);
    expect(record.ranked).toBe(result.ranked);
    expect(record.finishedAt).toStrictEqual(new Date(5000));
  });

  it('identifies a snippet by exactly the four columns that decide its text', () => {
    expect(Object.keys(snippetOf(result)).sort()).toStrictEqual([
      'generatorVersion',
      'language',
      'lines',
      'seed',
    ]);
  });
});
