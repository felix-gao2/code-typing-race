import { randomInt } from 'node:crypto';
import { generateSnippet, type Language } from '@ctr/generator';
import {
  apply,
  create,
  tick,
  type RaceConfig,
  type RaceEvent,
  type RaceKind,
  type RaceState,
} from '@ctr/race-machine';

/**
 * Rooms live in memory and die with the process. `SPEC.md` is explicit that
 * this is enough until one server is not, and that Redis arrives when rooms
 * actually break across instances rather than before.
 */

/**
 * Unambiguous when read aloud or copied out of a chat message: no 0/O, no
 * 1/I/l. Room codes get pasted into Discord and typed back in by hand.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

export interface RoomRequest {
  readonly language: Language;
  readonly lines: number;
  readonly config: RaceConfig;
  /** Private by default; matchmaking opens public ones. */
  readonly kind?: RaceKind;
}

export interface Room {
  readonly id: string;
  /** The seed the snippet came from, so a result can name the exact snippet. */
  readonly seed: number;
  readonly language: Language;
  readonly lines: number;
  /** When the room was opened, so an abandoned link can be swept up later. */
  readonly createdAt: number;
  state: RaceState;
  /** The timer handle for this room's pending deadline, if one is scheduled. */
  timer?: ReturnType<typeof setTimeout> | undefined;
}

export class Rooms {
  private readonly rooms = new Map<string, Room>();

  /** Opens a room. Private unless the caller says otherwise. */
  open(request: RoomRequest, now: number): Room {
    const id = this.freshId();
    const seed = randomInt(2 ** 31);
    const room: Room = {
      id,
      seed,
      language: request.language,
      lines: request.lines,
      createdAt: now,
      state: create({
        kind: request.kind ?? 'private',
        text: generateSnippet({ seed, language: request.language, lines: request.lines }),
        config: request.config,
      }),
    };
    this.rooms.set(id, room);
    return room;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /**
   * Public rooms someone could still be dropped into: right language, right
   * length, still waiting, and not full. The language and length both have to
   * match because they decide the snippet — racing different text is not a
   * race.
   */
  joinablePublic(language: Language, lines: number): Room[] {
    return [...this.rooms.values()].filter(
      (room) =>
        room.state.kind === 'public' &&
        room.language === language &&
        room.lines === lines &&
        room.state.phase === 'waiting' &&
        room.state.racers.length < room.state.config.maxRacers,
    );
  }

  /**
   * Applies an event to a room's race. Returns the room when the state
   * actually moved, so a caller knows whether anything is worth broadcasting.
   */
  dispatch(id: string, event: RaceEvent): Room | undefined {
    const room = this.rooms.get(id);
    if (room === undefined) {
      return undefined;
    }
    const next = apply(room.state, event);
    if (next === room.state) {
      return undefined;
    }
    room.state = next;
    return room;
  }

  /**
   * Advances a room's clock. Returns the room's next deadline so the caller
   * can schedule it, and whether the state moved — a countdown expiring is a
   * broadcast, a tick that changed nothing is not.
   */
  advance(
    id: string,
    now: number,
  ): { room: Room; deadline: number | undefined; moved: boolean } | undefined {
    const room = this.rooms.get(id);
    if (room === undefined) {
      return undefined;
    }
    const result = tick(room.state, now);
    const moved = result.state !== room.state;
    room.state = result.state;
    return { room, deadline: result.deadline, moved };
  }

  /** Drops a room and cancels anything it had scheduled. */
  close(id: string): boolean {
    const room = this.rooms.get(id);
    if (room === undefined) {
      return false;
    }
    if (room.timer !== undefined) {
      clearTimeout(room.timer);
    }
    return this.rooms.delete(id);
  }

  /**
   * Rooms that are over, and rooms nobody ever opened the link for. The grace
   * period matters: a room with no racers is the normal state between creating
   * a link and someone pasting it, so an age check is what separates an
   * abandoned room from a brand new one.
   */
  reap(now: number, graceMs: number): string[] {
    const dropped: string[] = [];
    for (const [id, room] of this.rooms) {
      const abandoned = room.state.racers.length === 0 && now - room.createdAt >= graceMs;
      if (room.state.phase === 'finished' || abandoned) {
        this.close(id);
        dropped.push(id);
      }
    }
    return dropped;
  }

  get size(): number {
    return this.rooms.size;
  }

  /**
   * Collisions are rare but not impossible, and a collision would drop two
   * strangers into the same room. Retrying is cheaper than reasoning about the
   * odds.
   */
  private freshId(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let id = '';
      for (let i = 0; i < CODE_LENGTH; i += 1) {
        id += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(id)) {
        return id;
      }
    }
    // 31^6 codes against a live room count this would never reach. If it does,
    // something is wrong that a retry will not fix.
    throw new Error('could not find an unused room code');
  }
}
