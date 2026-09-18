import type { RaceConfig } from '@ctr/race-machine';
import { describe, expect, it, vi } from 'vitest';
import { Rooms, type Room, type RoomRequest } from './rooms.ts';
import { Scheduler } from './schedule.ts';

const CONFIG: RaceConfig = {
  minRacers: 2,
  maxRacers: 4,
  countdownMs: 3000,
  raceTimeoutMs: 60_000,
};

const REQUEST: RoomRequest = { language: 'java', lines: 20, config: CONFIG };

/** A scheduler over a clock the test moves by hand. */
function harness() {
  const rooms = new Rooms();
  const broadcasts: Room[] = [];
  let now = 0;
  const scheduler = new Scheduler(
    rooms,
    (room) => broadcasts.push(room),
    () => now,
  );
  return {
    rooms,
    scheduler,
    broadcasts,
    set: (at: number): void => {
      now = at;
    },
  };
}

describe('sync', () => {
  it('arms a timer when the room has a deadline', () => {
    const { rooms, scheduler } = harness();
    const room = rooms.open(REQUEST, 0);
    rooms.dispatch(room.id, { type: 'join', id: 'a', at: 0 });
    rooms.dispatch(room.id, { type: 'join', id: 'b', at: 0 });

    scheduler.sync(room.id);
    expect(room.timer).toBeDefined();
    scheduler.cancel(room);
  });

  it('arms nothing when the room is waiting on people rather than the clock', () => {
    const { rooms, scheduler } = harness();
    const room = rooms.open(REQUEST, 0);
    rooms.dispatch(room.id, { type: 'join', id: 'a', at: 0 });

    // One racer, no waitTimeoutMs: nothing the clock can do here.
    scheduler.sync(room.id);
    expect(room.timer).toBeUndefined();
  });

  it('broadcasts only when the state actually moved', () => {
    const { rooms, scheduler, broadcasts, set } = harness();
    const room = rooms.open(REQUEST, 0);
    rooms.dispatch(room.id, { type: 'join', id: 'a', at: 0 });
    rooms.dispatch(room.id, { type: 'join', id: 'b', at: 0 });

    scheduler.sync(room.id);
    expect(broadcasts).toHaveLength(0);

    set(CONFIG.countdownMs);
    scheduler.sync(room.id);
    expect(broadcasts).toHaveLength(1);
    expect(room.state.phase).toBe('racing');
    scheduler.cancel(room);
  });

  it('replaces the previous timer rather than stacking them', () => {
    const { rooms, scheduler } = harness();
    const room = rooms.open(REQUEST, 0);
    rooms.dispatch(room.id, { type: 'join', id: 'a', at: 0 });
    rooms.dispatch(room.id, { type: 'join', id: 'b', at: 0 });

    scheduler.sync(room.id);
    const first = room.timer;
    scheduler.sync(room.id);
    expect(room.timer).not.toBe(first);
    scheduler.cancel(room);
  });

  it('does nothing for a room that does not exist', () => {
    const { scheduler, broadcasts } = harness();
    expect(() => scheduler.sync('NOPE12')).not.toThrow();
    expect(broadcasts).toHaveLength(0);
  });
});

describe('firing', () => {
  it('advances the race when the timer actually fires', async () => {
    vi.useFakeTimers();
    try {
      const { rooms, scheduler, broadcasts, set } = harness();
      const room = rooms.open(REQUEST, 0);
      rooms.dispatch(room.id, { type: 'join', id: 'a', at: 0 });
      rooms.dispatch(room.id, { type: 'join', id: 'b', at: 0 });

      scheduler.sync(room.id);
      expect(room.state.phase).toBe('countdown');

      // The injected clock and the fake timers move together, the way the real
      // clock and real timers do.
      set(CONFIG.countdownMs);
      await vi.advanceTimersByTimeAsync(CONFIG.countdownMs);

      expect(room.state.phase).toBe('racing');
      expect(broadcasts).toHaveLength(1);
      scheduler.cancel(room);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs a whole race to its timeout without anyone typing', async () => {
    vi.useFakeTimers();
    try {
      const { rooms, scheduler, set } = harness();
      const room = rooms.open(REQUEST, 0);
      rooms.dispatch(room.id, { type: 'join', id: 'a', at: 0 });
      rooms.dispatch(room.id, { type: 'join', id: 'b', at: 0 });
      scheduler.sync(room.id);

      const end = CONFIG.countdownMs + CONFIG.raceTimeoutMs;
      set(end);
      await vi.advanceTimersByTimeAsync(end);

      // This is the disconnect-forever case seen from the server's side.
      expect(room.state.phase).toBe('finished');
      expect(room.timer).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('cancel', () => {
  it('clears the handle so a dead room cannot fire', () => {
    const { rooms, scheduler } = harness();
    const room = rooms.open(REQUEST, 0);
    rooms.dispatch(room.id, { type: 'join', id: 'a', at: 0 });
    rooms.dispatch(room.id, { type: 'join', id: 'b', at: 0 });
    scheduler.sync(room.id);

    scheduler.cancel(room);
    expect(room.timer).toBeUndefined();
  });
});
