import { type RaceConfig } from '@ctr/race-machine';
import { mapTarget, type InputEvent } from '@ctr/typing-engine';
import { describe, expect, it } from 'vitest';
import { Rooms, type Room, type RoomRequest } from './rooms.ts';
import { firstError, playerSchema, raceRequestSchema, submitPayloadSchema } from './wire.ts';

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

/** A flawless run of the room's snippet, so a valid keystream is a real one. */
function perfectRun(text: string, msPerKey = 100): InputEvent[] {
  let at = 1000;
  return mapTarget(text).chars.map((typeable) => ({
    kind: 'char' as const,
    char: typeable.char,
    at: (at += msPerKey),
  }));
}

/**
 * The schemas themselves, rather than the sockets that use them. Each case is
 * something a client could actually send: a forged field, a flood, a name left
 * out. `SPEC.md` puts Zod on the wire so these answers live in one place.
 */
describe('the wire schemas', () => {
  const events = perfectRun(room().state.text);

  it('strips what it did not ask for, so a forged field cannot reach a handler', () => {
    const sent = submitPayloadSchema.parse({
      events,
      player: { id: 'p1', name: 'felix', admin: true },
      // The one number a client must never be able to state.
      wpm: 999,
    });

    expect(sent).not.toHaveProperty('wpm');
    expect(sent.player).not.toHaveProperty('admin');
    expect(Object.keys(sent).sort()).toStrictEqual(['events', 'player']);
  });

  it('refuses a keystream long enough to be a flood, on the socket as on the route', () => {
    const flood = Array.from({ length: 20_001 }, (_, i) => ({ kind: 'char', char: 'a', at: i }));
    const sent = submitPayloadSchema.safeParse({ flood, player: { id: 'p1' }, events: flood });

    expect(sent.success).toBe(false);
    expect(firstError(sent.error!)).toMatch(/at most/);
  });

  it('refuses an id longer than the column that has to hold it', () => {
    expect(playerSchema.safeParse({ id: 'p'.repeat(65) }).success).toBe(false);
    expect(playerSchema.safeParse({ id: 'p'.repeat(64) }).success).toBe(true);
  });

  it('refuses a player with no id, and accepts one with no name', () => {
    expect(playerSchema.safeParse({ name: 'felix' }).success).toBe(false);
    expect(playerSchema.safeParse({ id: '' }).success).toBe(false);
    expect(playerSchema.parse({ id: 'p1' })).toStrictEqual({ id: 'p1' });
  });

  it('names the languages it knows rather than saying only that one is wrong', () => {
    const asked = raceRequestSchema.safeParse({ language: 'cobol', lines: 10 });

    expect(firstError(asked.error!)).toBe('language must be one of java, typescript, python');
  });

  it('refuses a line count that would ask the generator for a day of work', () => {
    expect(raceRequestSchema.safeParse({ language: 'java', lines: 201 }).success).toBe(false);
    expect(raceRequestSchema.safeParse({ language: 'java', lines: 0 }).success).toBe(false);
    expect(raceRequestSchema.safeParse({ language: 'java', lines: 10.5 }).success).toBe(false);
    expect(raceRequestSchema.safeParse({ language: 'java', lines: 200 }).success).toBe(true);
  });

  it('refuses the numbers that are not numbers', () => {
    const bad = [Number.NaN, Number.POSITIVE_INFINITY];
    for (const at of bad) {
      expect(
        submitPayloadSchema.safeParse({ events: [{ kind: 'backspace', at }], player: { id: 'p1' } })
          .success,
      ).toBe(false);
    }
  });

  it('gives a client one sentence rather than a dump of every issue', () => {
    const asked = raceRequestSchema.safeParse({ language: 'cobol', lines: 0 });

    expect(firstError(asked.error!).split('\n')).toHaveLength(1);
  });
});

describe('a request with no body at all', () => {
  it('is answered in the server’s words rather than the validator’s', () => {
    const asked = raceRequestSchema.safeParse(undefined);

    expect(firstError(asked.error!)).toBe('expected a language and a line count');
  });
});
