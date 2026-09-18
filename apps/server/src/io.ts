import { GENERATOR_VERSION } from '@ctr/generator';
import type { RaceState } from '@ctr/race-machine';
import {
  DEFAULT_MODE,
  ENGINE_VERSION,
  isFinished,
  measure,
  replay,
  type InputEvent,
  type RunMetrics,
} from '@ctr/typing-engine';
import type { Server, Socket } from 'socket.io';
import type { Room, Rooms } from './rooms.ts';
import type { Scheduler } from './schedule.ts';

/**
 * Socket wiring: client messages in, race events out, state broadcast back.
 *
 * Nothing a client sends is taken at face value. Progress is advisory and only
 * ever moves the bar; the result that counts is recomputed here from the
 * submitted keystream.
 */

/** What a racer sends when they think they are done. */
export interface SubmitPayload {
  readonly events: readonly InputEvent[];
}

/** The verified result, as the server computed it. */
export interface RunResult {
  readonly racerId: string;
  readonly metrics: RunMetrics;
  /** Both versions travel with the result, so a stored run can always be told
   * which rules produced it. */
  readonly generatorVersion: number;
  readonly engineVersion: number;
  readonly seed: number;
  readonly language: string;
  readonly lines: number;
  readonly engineMode: string;
}

/** What every client is shown. The keystream never leaves the server. */
export interface RaceView {
  readonly id: string;
  readonly phase: RaceState['phase'];
  readonly kind: RaceState['kind'];
  readonly text: string;
  readonly startedAt: number | undefined;
  readonly racers: readonly {
    readonly id: string;
    readonly progress: number;
    readonly connected: boolean;
    readonly finishedAt: number | undefined;
  }[];
}

export function viewOf(room: Room): RaceView {
  return {
    id: room.id,
    phase: room.state.phase,
    kind: room.state.kind,
    text: room.state.text,
    startedAt: room.state.startedAt,
    racers: room.state.racers.map((racer) => ({
      id: racer.id,
      progress: racer.progress,
      connected: racer.connected,
      finishedAt: racer.finishedAt,
    })),
  };
}

/**
 * Recomputes a submitted run. The client's own WPM is never asked for and
 * would not be believed — a keystream is the only thing it can send that the
 * server can check, which is the whole reason runs travel as keystreams.
 *
 * Throws when the keystream is not a valid run of this text; the engine
 * already rejects timestamps that go backwards.
 */
export function verify(room: Room, racerId: string, payload: SubmitPayload): RunResult {
  const state = replay(room.state.text, payload.events, DEFAULT_MODE);
  if (!isFinished(state)) {
    throw new Error('submitted keystream does not finish the snippet');
  }
  return {
    racerId,
    metrics: measure(state),
    generatorVersion: GENERATOR_VERSION,
    engineVersion: ENGINE_VERSION,
    seed: room.seed,
    language: room.language,
    lines: room.lines,
    engineMode: DEFAULT_MODE,
  };
}

export interface AttachOptions {
  readonly rooms: Rooms;
  readonly scheduler: Scheduler;
  readonly now?: () => number;
}

export function attach(
  io: Server,
  { rooms, scheduler, now = () => Date.now() }: AttachOptions,
): void {
  const broadcast = (room: Room): void => {
    io.to(room.id).emit('race', viewOf(room));
  };

  io.on('connection', (socket: Socket) => {
    // One socket is one racer in one room. A second join from the same socket
    // would leave the first room without anyone to report it.
    let joined: { roomId: string; racerId: string } | undefined;

    socket.on('join', (roomId: unknown, ack?: (response: unknown) => void) => {
      if (typeof roomId !== 'string' || joined !== undefined) {
        ack?.({ ok: false, error: 'bad join' });
        return;
      }
      const room = rooms.get(roomId);
      if (room === undefined) {
        ack?.({ ok: false, error: 'no such room' });
        return;
      }

      const racerId = socket.id;
      const moved = rooms.dispatch(roomId, { type: 'join', id: racerId, at: now() });
      if (moved === undefined) {
        // The machine refused: the race has started, or the room is full.
        ack?.({ ok: false, error: 'cannot join this race' });
        return;
      }

      joined = { roomId, racerId };
      void socket.join(roomId);
      ack?.({ ok: true, racerId, race: viewOf(room) });
      broadcast(room);
      scheduler.sync(roomId);
    });

    socket.on('progress', (value: unknown) => {
      if (joined === undefined || typeof value !== 'number' || !Number.isFinite(value)) {
        return;
      }
      // Advisory only: this moves a progress bar and nothing else. The machine
      // clamps it, and the result that counts is recomputed on submit.
      const moved = rooms.dispatch(joined.roomId, {
        type: 'progress',
        id: joined.racerId,
        progress: value,
        at: now(),
      });
      if (moved !== undefined) {
        broadcast(moved);
      }
    });

    socket.on('submit', (payload: unknown, ack?: (response: unknown) => void) => {
      if (joined === undefined || !isSubmitPayload(payload)) {
        ack?.({ ok: false, error: 'bad submission' });
        return;
      }
      const room = rooms.get(joined.roomId);
      if (room === undefined) {
        ack?.({ ok: false, error: 'no such room' });
        return;
      }

      let result: RunResult;
      try {
        result = verify(room, joined.racerId, payload);
      } catch (error) {
        // A keystream that does not produce this snippet is a bug or a forgery,
        // and either way it is not a finish. Say so rather than swallowing it.
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'invalid run' });
        return;
      }

      const moved = rooms.dispatch(joined.roomId, {
        type: 'finish',
        id: joined.racerId,
        at: now(),
      });
      ack?.({ ok: true, result });
      io.to(joined.roomId).emit('result', result);
      if (moved !== undefined) {
        broadcast(moved);
      }
      scheduler.sync(joined.roomId);
    });

    socket.on('disconnect', () => {
      if (joined === undefined) {
        return;
      }
      // Disconnect, not leave: the racer keeps their place and their progress
      // in case they come back. The race deadline is what eventually calls it.
      const moved = rooms.dispatch(joined.roomId, {
        type: 'disconnect',
        id: joined.racerId,
        at: now(),
      });
      if (moved !== undefined) {
        broadcast(moved);
      }
      scheduler.sync(joined.roomId);
    });
  });
}

function isSubmitPayload(value: unknown): value is SubmitPayload {
  if (typeof value !== 'object' || value === null || !('events' in value)) {
    return false;
  }
  const { events } = value;
  return Array.isArray(events) && events.every(isInputEvent);
}

function isInputEvent(value: unknown): value is InputEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const event = value as { kind?: unknown; char?: unknown; at?: unknown };
  if (typeof event.at !== 'number' || !Number.isFinite(event.at)) {
    return false;
  }
  if (event.kind === 'backspace') {
    return true;
  }
  return event.kind === 'char' && typeof event.char === 'string' && event.char.length > 0;
}
