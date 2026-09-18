import { describe, expect, it } from 'vitest';
import { apply, create, deadlineOf, tick, type RaceEvent } from './machine.ts';
import { isRunning, racer, type RaceConfig, type RaceState } from './state.ts';

const CONFIG: RaceConfig = {
  minRacers: 2,
  maxRacers: 4,
  countdownMs: 3000,
  raceTimeoutMs: 60_000,
};

function race(config: Partial<RaceConfig> = {}): RaceState {
  return create({ kind: 'public', text: 'let n = 1;', config: { ...CONFIG, ...config } });
}

/** Applies events in order, which is how every test past the first builds a race. */
function run(state: RaceState, ...events: RaceEvent[]): RaceState {
  return events.reduce(apply, state);
}

/** Two racers joined and the countdown elapsed: the common starting point. */
function racing(config: Partial<RaceConfig> = {}): RaceState {
  const joined = run(
    race(config),
    { type: 'join', id: 'a', at: 0 },
    { type: 'join', id: 'b', at: 0 },
  );
  return tick(joined, CONFIG.countdownMs).state;
}

describe('joining', () => {
  it('waits below minRacers and counts down on reaching it', () => {
    const one = apply(race(), { type: 'join', id: 'a', at: 0 });
    expect(one.phase).toBe('waiting');

    const two = apply(one, { type: 'join', id: 'b', at: 500 });
    expect(two.phase).toBe('countdown');
    expect(two.phaseStartedAt).toBe(500);
  });

  it('refuses a duplicate id', () => {
    const once = apply(race(), { type: 'join', id: 'a', at: 0 });
    expect(apply(once, { type: 'join', id: 'a', at: 1 })).toBe(once);
  });

  it('refuses a join past maxRacers', () => {
    const full = run(
      race({ minRacers: 4, maxRacers: 2 }),
      { type: 'join', id: 'a', at: 0 },
      { type: 'join', id: 'b', at: 0 },
    );
    expect(apply(full, { type: 'join', id: 'c', at: 0 }).racers).toHaveLength(2);
  });

  it('refuses a join once the race is running', () => {
    const started = racing();
    expect(apply(started, { type: 'join', id: 'c', at: 10 })).toBe(started);
  });
});

describe('the countdown', () => {
  it('starts racing at the deadline, not at the moment tick arrived', () => {
    const counting = run(
      race(),
      { type: 'join', id: 'a', at: 0 },
      { type: 'join', id: 'b', at: 0 },
    );
    // A tick that shows up late must not hand racers a later start time than a
    // punctual one would have, or two servers disagree about the same race.
    const late = tick(counting, CONFIG.countdownMs + 5000);
    expect(late.state.phase).toBe('racing');
    expect(late.state.startedAt).toBe(CONFIG.countdownMs);
  });

  it('holds while the countdown is still running', () => {
    const counting = run(
      race(),
      { type: 'join', id: 'a', at: 0 },
      { type: 'join', id: 'b', at: 0 },
    );
    const early = tick(counting, CONFIG.countdownMs - 1);
    expect(early.state.phase).toBe('countdown');
    expect(early.deadline).toBe(CONFIG.countdownMs);
  });

  it('falls back to waiting when a leave drops it below minRacers', () => {
    const counting = run(
      race(),
      { type: 'join', id: 'a', at: 0 },
      { type: 'join', id: 'b', at: 0 },
    );
    expect(apply(counting, { type: 'leave', id: 'b', at: 1 }).phase).toBe('waiting');
  });
});

describe('waiting alone', () => {
  it('waits forever when no waitTimeoutMs is set', () => {
    const alone = apply(race(), { type: 'join', id: 'a', at: 0 });
    expect(deadlineOf(alone)).toBeUndefined();
    expect(tick(alone, 10_000_000).state.phase).toBe('waiting');
  });

  it('starts with whoever turned up once waitTimeoutMs passes', () => {
    const alone = apply(race({ waitTimeoutMs: 8000 }), { type: 'join', id: 'a', at: 1000 });
    // The wait is measured from the first arrival, not from the empty room.
    expect(deadlineOf(alone)).toBe(9000);
    expect(tick(alone, 8999).state.phase).toBe('waiting');
    expect(tick(alone, 9000).state.phase).toBe('countdown');
  });

  it('does not start an empty race when the wait expires', () => {
    const empty = race({ waitTimeoutMs: 8000 });
    expect(tick(empty, 100_000).state.phase).toBe('waiting');
  });
});

describe('progress', () => {
  it('records progress while racing', () => {
    const moved = apply(racing(), { type: 'progress', id: 'a', progress: 0.4, at: 10 });
    expect(racer(moved, 'a')?.progress).toBe(0.4);
  });

  it('ignores a stale packet that would move a racer backwards', () => {
    const ahead = apply(racing(), { type: 'progress', id: 'a', progress: 0.6, at: 10 });
    expect(apply(ahead, { type: 'progress', id: 'a', progress: 0.2, at: 11 })).toBe(ahead);
  });

  it('ignores progress before the race starts', () => {
    const counting = run(
      race(),
      { type: 'join', id: 'a', at: 0 },
      { type: 'join', id: 'b', at: 0 },
    );
    expect(apply(counting, { type: 'progress', id: 'a', progress: 0.5, at: 1 })).toBe(counting);
  });
});

describe('finishing', () => {
  it('ends once the last racer crosses', () => {
    const first = apply(racing(), { type: 'finish', id: 'a', at: 9000 });
    expect(first.phase).toBe('racing');
    expect(racer(first, 'a')?.progress).toBe(1);

    const both = apply(first, { type: 'finish', id: 'b', at: 9500 });
    expect(both.phase).toBe('finished');
  });

  it('ignores a second finish from the same racer', () => {
    const done = apply(racing(), { type: 'finish', id: 'a', at: 9000 });
    expect(apply(done, { type: 'finish', id: 'a', at: 9999 })).toBe(done);
  });

  it('keeps finish times so placings can be read off the state', () => {
    const both = run(
      racing(),
      { type: 'finish', id: 'b', at: 8000 },
      { type: 'finish', id: 'a', at: 9000 },
    );
    expect(racer(both, 'b')?.finishedAt).toBe(8000);
    expect(racer(both, 'a')?.finishedAt).toBe(9000);
  });
});

/**
 * The case SPEC.md calls out as the one that rots projects like this. A race
 * must neither end the instant someone's wifi blinks nor hang forever waiting
 * for someone who is never coming back.
 */
describe('disconnecting mid-race', () => {
  it('keeps the racer and their progress', () => {
    const dropped = run(
      racing(),
      { type: 'progress', id: 'a', progress: 0.5, at: 10 },
      { type: 'disconnect', id: 'a', at: 20 },
    );
    expect(dropped.racers).toHaveLength(2);
    expect(racer(dropped, 'a')?.progress).toBe(0.5);
    expect(racer(dropped, 'a')?.connected).toBe(false);
    expect(dropped.phase).toBe('racing');
  });

  it('restores them on reconnect', () => {
    const back = run(
      racing(),
      { type: 'progress', id: 'a', progress: 0.5, at: 10 },
      { type: 'disconnect', id: 'a', at: 20 },
      { type: 'reconnect', id: 'a', at: 30 },
    );
    expect(racer(back, 'a')?.connected).toBe(true);
    expect(racer(back, 'a')?.progress).toBe(0.5);
    expect(back.phase).toBe('racing');
  });

  it('accepts progress again after a reconnect', () => {
    const back = run(
      racing(),
      { type: 'disconnect', id: 'a', at: 20 },
      { type: 'reconnect', id: 'a', at: 30 },
      { type: 'progress', id: 'a', progress: 0.7, at: 40 },
    );
    expect(racer(back, 'a')?.progress).toBe(0.7);
  });

  it('ends the race when the only racer still running drops', () => {
    const over = run(
      racing(),
      { type: 'finish', id: 'a', at: 9000 },
      { type: 'disconnect', id: 'b', at: 9100 },
    );
    // Nobody is left to wait for: a finished racer and a dropped one.
    expect(over.phase).toBe('finished');
  });

  it('times out a racer who never comes back', () => {
    const dropped = apply(racing(), { type: 'disconnect', id: 'a', at: 20 });
    const stillGoing = tick(dropped, CONFIG.raceTimeoutMs - 1);
    expect(stillGoing.state.phase).toBe('racing');
    expect(stillGoing.deadline).toBe(CONFIG.countdownMs + CONFIG.raceTimeoutMs);

    // The race deadline is what stops this hanging forever.
    const called = tick(dropped, CONFIG.countdownMs + CONFIG.raceTimeoutMs);
    expect(called.state.phase).toBe('finished');
  });
});

describe('purity', () => {
  it('returns the same object when an event changes nothing', () => {
    const started = racing();
    expect(apply(started, { type: 'progress', id: 'ghost', progress: 0.5, at: 1 })).toBe(started);
    expect(apply(started, { type: 'finish', id: 'ghost', at: 1 })).toBe(started);
    expect(apply(started, { type: 'reconnect', id: 'a', at: 1 })).toBe(started);
  });

  it('never mutates the state it was given', () => {
    const started = racing();
    const before = structuredClone(started);
    apply(started, { type: 'progress', id: 'a', progress: 0.9, at: 10 });
    apply(started, { type: 'finish', id: 'b', at: 10 });
    tick(started, 10_000_000);
    expect(started).toEqual(before);
  });

  it('crosses more than one phase in a single tick', () => {
    // A server that slept through the countdown and the whole race should land
    // on finished, not sit in countdown waiting to be ticked three more times.
    const counting = run(
      race(),
      { type: 'join', id: 'a', at: 0 },
      { type: 'join', id: 'b', at: 0 },
    );
    const late = tick(counting, CONFIG.countdownMs + CONFIG.raceTimeoutMs + 1);
    expect(late.state.phase).toBe('finished');
    expect(late.deadline).toBeUndefined();
  });

  it('leaves a finished race alone', () => {
    const over = run(
      racing(),
      { type: 'finish', id: 'a', at: 9000 },
      { type: 'finish', id: 'b', at: 9500 },
    );
    expect(tick(over, 10_000_000).state).toBe(over);
    expect(apply(over, { type: 'join', id: 'c', at: 10_000 })).toBe(over);
  });
});

describe('race kind', () => {
  it('is carried from creation so a result always knows where it came from', () => {
    expect(race().kind).toBe('public');
    expect(create({ kind: 'private', text: 'x', config: CONFIG }).kind).toBe('private');
  });
});

describe('isRunning', () => {
  it('is true only for a connected racer who has not finished', () => {
    const started = racing();
    expect(started.racers.every(isRunning)).toBe(true);

    const done = apply(started, { type: 'finish', id: 'a', at: 9000 });
    expect(isRunning(racer(done, 'a')!)).toBe(false);
    expect(isRunning(racer(done, 'b')!)).toBe(true);
  });
});
