import type { RaceConfig } from '@ctr/race-machine';
import { describe, expect, it } from 'vitest';
import { Rooms, type RoomRequest } from './rooms.ts';

const CONFIG: RaceConfig = {
  minRacers: 2,
  maxRacers: 4,
  countdownMs: 3000,
  raceTimeoutMs: 60_000,
};

const REQUEST: RoomRequest = { language: 'java', lines: 20, config: CONFIG };

describe('opening a room', () => {
  it('generates the snippet the room will be raced on', () => {
    const room = new Rooms().open(REQUEST, 0);
    expect(room.state.text.split('\n')).toHaveLength(20);
    expect(room.state.kind).toBe('private');
    expect(room.state.phase).toBe('waiting');
  });

  it('records the seed so a result can name the exact snippet', () => {
    const rooms = new Rooms();
    const room = rooms.open(REQUEST, 0);
    expect(Number.isInteger(room.seed)).toBe(true);
    expect(room.language).toBe('java');
    expect(room.lines).toBe(20);
  });

  it('gives every room a distinct code', () => {
    const rooms = new Rooms();
    const codes = new Set(Array.from({ length: 200 }, () => rooms.open(REQUEST, 0).id));
    expect(codes.size).toBe(200);
  });

  it('uses a code alphabet with no look-alike characters', () => {
    const rooms = new Rooms();
    for (let i = 0; i < 100; i += 1) {
      // Room codes get read aloud and typed back in, so 0/O and 1/I/l are out.
      expect(rooms.open(REQUEST, 0).id).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it('finds a room by its code, and nothing by a wrong one', () => {
    const rooms = new Rooms();
    const room = rooms.open(REQUEST, 0);
    expect(rooms.get(room.id)).toBe(room);
    expect(rooms.get('NOPE12')).toBeUndefined();
  });
});

describe('dispatching events', () => {
  it('moves the room state and reports that it moved', () => {
    const rooms = new Rooms();
    const room = rooms.open(REQUEST, 0);
    const moved = rooms.dispatch(room.id, { type: 'join', id: 'a', at: 0 });
    expect(moved).toBe(room);
    expect(room.state.racers).toHaveLength(1);
  });

  it('reports nothing when the event changed nothing', () => {
    const rooms = new Rooms();
    const room = rooms.open(REQUEST, 0);
    rooms.dispatch(room.id, { type: 'join', id: 'a', at: 0 });
    // A duplicate join is refused by the machine, so there is nothing to send.
    expect(rooms.dispatch(room.id, { type: 'join', id: 'a', at: 1 })).toBeUndefined();
  });

  it('reports nothing for a room that does not exist', () => {
    expect(new Rooms().dispatch('NOPE12', { type: 'join', id: 'a', at: 0 })).toBeUndefined();
  });
});

describe('closing', () => {
  it('removes the room', () => {
    const rooms = new Rooms();
    const room = rooms.open(REQUEST, 0);
    expect(rooms.close(room.id)).toBe(true);
    expect(rooms.get(room.id)).toBeUndefined();
    expect(rooms.size).toBe(0);
  });

  it('is false for a room that is already gone', () => {
    expect(new Rooms().close('NOPE12')).toBe(false);
  });

  it('cancels a pending timer so a dead room cannot fire', () => {
    const rooms = new Rooms();
    const room = rooms.open(REQUEST, 0);
    let fired = false;
    room.timer = setTimeout(() => {
      fired = true;
    }, 1);
    rooms.close(room.id);
    return new Promise((resolve) => setTimeout(resolve, 20)).then(() => {
      expect(fired).toBe(false);
    });
  });
});

describe('reaping', () => {
  it('keeps a brand new room nobody has opened the link for yet', () => {
    const rooms = new Rooms();
    const room = rooms.open(REQUEST, 1000);
    // The normal state between creating a link and someone pasting it.
    expect(rooms.reap(1000 + 5000, 60_000)).toEqual([]);
    expect(rooms.get(room.id)).toBeDefined();
  });

  it('drops an empty room once the grace period has passed', () => {
    const rooms = new Rooms();
    const room = rooms.open(REQUEST, 1000);
    expect(rooms.reap(1000 + 60_000, 60_000)).toEqual([room.id]);
    expect(rooms.size).toBe(0);
  });

  it('keeps an occupied room however old it is', () => {
    const rooms = new Rooms();
    const room = rooms.open(REQUEST, 0);
    rooms.dispatch(room.id, { type: 'join', id: 'a', at: 0 });
    expect(rooms.reap(10_000_000, 60_000)).toEqual([]);
  });

  it('drops a finished room', () => {
    const rooms = new Rooms();
    const room = rooms.open(REQUEST, 0);
    rooms.dispatch(room.id, { type: 'join', id: 'a', at: 0 });
    rooms.dispatch(room.id, { type: 'join', id: 'b', at: 0 });
    // The countdown has to elapse before anyone can be racing, let alone done.
    rooms.advance(room.id, CONFIG.countdownMs);
    rooms.dispatch(room.id, { type: 'finish', id: 'a', at: 5000 });
    rooms.dispatch(room.id, { type: 'finish', id: 'b', at: 6000 });
    expect(room.state.phase).toBe('finished');
    expect(rooms.reap(6000, 60_000)).toEqual([room.id]);
  });
});

describe('advancing the clock', () => {
  it('reports the next deadline so the caller can schedule it', () => {
    const rooms = new Rooms();
    const room = rooms.open(REQUEST, 0);
    rooms.dispatch(room.id, { type: 'join', id: 'a', at: 0 });
    rooms.dispatch(room.id, { type: 'join', id: 'b', at: 0 });

    const counting = rooms.advance(room.id, 0);
    expect(counting?.deadline).toBe(CONFIG.countdownMs);
    expect(counting?.moved).toBe(false);

    const started = rooms.advance(room.id, CONFIG.countdownMs);
    expect(started?.moved).toBe(true);
    expect(room.state.phase).toBe('racing');
  });

  it('reports nothing for a room that does not exist', () => {
    expect(new Rooms().advance('NOPE12', 0)).toBeUndefined();
  });
});
