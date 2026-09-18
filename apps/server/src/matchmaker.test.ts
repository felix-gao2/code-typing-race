import type { RaceConfig } from '@ctr/race-machine';
import { describe, expect, it } from 'vitest';
import { Matchmaker } from './matchmaker.ts';
import { Rooms } from './rooms.ts';

/** Public defaults: start alone after 10s, per the decision in PROGRESS.md. */
const PUBLIC: RaceConfig = {
  minRacers: 2,
  maxRacers: 4,
  countdownMs: 3000,
  raceTimeoutMs: 60_000,
  waitTimeoutMs: 10_000,
};

function harness() {
  const rooms = new Rooms();
  return { rooms, matcher: new Matchmaker(rooms, PUBLIC) };
}

describe('finding a race', () => {
  it('opens a public room when there is nothing to join', () => {
    const { rooms, matcher } = harness();
    const room = matcher.find({ language: 'java', lines: 20 }, 0);

    expect(room.state.kind).toBe('public');
    expect(room.state.phase).toBe('waiting');
    expect(rooms.size).toBe(1);
  });

  it('puts the second racer into the first racer’s race', () => {
    const { rooms, matcher } = harness();
    const first = matcher.find({ language: 'java', lines: 20 }, 0);
    rooms.dispatch(first.id, { type: 'join', id: 'a', at: 0 });

    const second = matcher.find({ language: 'java', lines: 20 }, 1);
    // The whole point: two people looking for a race find each other.
    expect(second.id).toBe(first.id);
    expect(rooms.size).toBe(1);
  });

  it('never mixes languages, because the snippet would differ', () => {
    const { matcher, rooms } = harness();
    const java = matcher.find({ language: 'java', lines: 20 }, 0);
    rooms.dispatch(java.id, { type: 'join', id: 'a', at: 0 });

    const python = matcher.find({ language: 'python', lines: 20 }, 1);
    expect(python.id).not.toBe(java.id);
    expect(rooms.size).toBe(2);
  });

  it('never mixes line counts, for the same reason', () => {
    const { matcher, rooms } = harness();
    const short = matcher.find({ language: 'java', lines: 10 }, 0);
    rooms.dispatch(short.id, { type: 'join', id: 'a', at: 0 });

    const long = matcher.find({ language: 'java', lines: 35 }, 1);
    expect(long.id).not.toBe(short.id);
  });

  it('prefers the race closest to starting', () => {
    const { rooms, matcher } = harness();
    // minRacers is raised so both rooms stay in `waiting` with racers in them;
    // at the default of 2 the fuller one would have started and stopped being
    // joinable, which is correct behaviour but not what this test is about.
    const roomy: RaceConfig = { ...PUBLIC, minRacers: 4 };
    const emptier = rooms.open({ language: 'java', lines: 20, config: roomy, kind: 'public' }, 0);
    const fuller = rooms.open({ language: 'java', lines: 20, config: roomy, kind: 'public' }, 0);
    rooms.dispatch(emptier.id, { type: 'join', id: 'a', at: 0 });
    rooms.dispatch(fuller.id, { type: 'join', id: 'b', at: 0 });
    rooms.dispatch(fuller.id, { type: 'join', id: 'c', at: 0 });

    // Pooling into one race beats spreading across several half-empty ones.
    expect(matcher.find({ language: 'java', lines: 20 }, 1).id).toBe(fuller.id);
  });

  it('opens a new race rather than joining one that already started', () => {
    const { rooms, matcher } = harness();
    const running = matcher.find({ language: 'java', lines: 20 }, 0);
    rooms.dispatch(running.id, { type: 'join', id: 'a', at: 0 });
    rooms.dispatch(running.id, { type: 'join', id: 'b', at: 0 });
    rooms.advance(running.id, PUBLIC.countdownMs);
    expect(running.state.phase).toBe('racing');

    const next = matcher.find({ language: 'java', lines: 20 }, 1);
    expect(next.id).not.toBe(running.id);
  });

  it('opens a new race rather than joining a full one', () => {
    const { rooms, matcher } = harness();
    const full = rooms.open(
      {
        language: 'java',
        lines: 20,
        config: { ...PUBLIC, minRacers: 9, maxRacers: 2 },
        kind: 'public',
      },
      0,
    );
    rooms.dispatch(full.id, { type: 'join', id: 'a', at: 0 });
    rooms.dispatch(full.id, { type: 'join', id: 'b', at: 0 });

    expect(matcher.find({ language: 'java', lines: 20 }, 1).id).not.toBe(full.id);
  });

  it('never hands out a private room', () => {
    const { rooms, matcher } = harness();
    const priv = rooms.open({ language: 'java', lines: 20, config: PUBLIC }, 0);
    rooms.dispatch(priv.id, { type: 'join', id: 'a', at: 0 });

    // A private room is someone's link, not a lobby to be dropped into.
    expect(matcher.find({ language: 'java', lines: 20 }, 1).id).not.toBe(priv.id);
  });
});

describe('racing alone', () => {
  it('starts a lone racer after the wait rather than stranding them', () => {
    const { rooms, matcher } = harness();
    const room = matcher.find({ language: 'java', lines: 20 }, 1000);
    rooms.dispatch(room.id, { type: 'join', id: 'a', at: 1000 });

    expect(rooms.advance(room.id, 10_999)?.room.state.phase).toBe('waiting');
    expect(rooms.advance(room.id, 11_000)?.room.state.phase).toBe('countdown');

    rooms.advance(room.id, 11_000 + PUBLIC.countdownMs);
    expect(room.state.phase).toBe('racing');
    // One racer started, which is what makes the result unranked.
    expect(room.state.startedWith).toBe(1);
  });
});
