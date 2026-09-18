import { GENERATOR_VERSION, isLinePreset, LANGUAGES, type Language } from '@ctr/generator';
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
import { ANONYMOUS, cleanName, type Player } from '@ctr/shared-types';
import type { Server, Socket } from 'socket.io';
import { db as defaultDb, type Db } from './db/index.ts';
import { recordRace, recordRun, type RunRecord, type SnippetIdentity } from './db/store.ts';
import type { Matchmaker } from './matchmaker.ts';
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
  /**
   * Who to credit the run to. The name is cleaned again here: it goes onto a
   * public board, and nothing off the wire is trusted — least of all the one
   * field a client gets to choose the text of.
   */
  readonly player: Player;
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
  /**
   * Whether this result may reach a leaderboard. Three things have to hold: it
   * was a public race, at least two people actually started it, and the length
   * is one of the ranked presets. A private room is someone's own link, a race
   * of one is a solo run wearing a race's clothes, and a custom length would
   * give every run a board of its own.
   */
  readonly ranked: boolean;
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
export function verify(
  room: Room,
  racerId: string,
  payload: Pick<SubmitPayload, 'events'>,
): RunResult {
  const state = replay(room.state.text, payload.events, DEFAULT_MODE);
  if (!isFinished(state)) {
    throw new Error('submitted keystream does not finish the snippet');
  }
  const startedWith = room.state.startedWith ?? 0;
  return {
    racerId,
    ranked: room.state.kind === 'public' && startedWith >= 2 && isLinePreset(room.lines),
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
  readonly matchmaker: Matchmaker;
  readonly now?: () => number;
  /** Injected so a test never reaches for a database that is not there. */
  readonly db?: () => Db | undefined;
}

export function attach(
  io: Server,
  { rooms, scheduler, matchmaker, now = () => Date.now(), db = defaultDb }: AttachOptions,
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

    /**
     * Public matchmaking. Answers with a room code; the client then joins it
     * exactly as it would a private one, so there is only one join path.
     */
    socket.on('quickmatch', (request: unknown, ack?: (response: unknown) => void) => {
      const { language, lines } = (request ?? {}) as { language?: unknown; lines?: unknown };
      if (typeof language !== 'string' || !LANGUAGES.includes(language as Language)) {
        ack?.({ ok: false, error: 'unknown language' });
        return;
      }
      if (typeof lines !== 'number' || !Number.isInteger(lines) || lines < 1 || lines > 200) {
        ack?.({ ok: false, error: 'lines must be an integer between 1 and 200' });
        return;
      }
      const room = matchmaker.find({ language: language as Language, lines }, now());
      ack?.({ ok: true, id: room.id });
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
      store(db(), room, result, payload.player, now());
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

/** The four columns a snippet is identified by, and nothing else. */
export function snippetOf(result: RunResult): SnippetIdentity {
  return {
    generatorVersion: result.generatorVersion,
    language: result.language,
    lines: result.lines,
    seed: result.seed,
  };
}

/**
 * The row for a finished run. Pure, so the one rule that matters here — the
 * client's name is cleaned again on the way in — is testable without a
 * database.
 */
export function runRecordOf(
  result: RunResult,
  player: Player,
  at: number,
  raceId?: string,
): RunRecord {
  return {
    playerId: player.id,
    playerName: cleanName(player.name ?? ANONYMOUS),
    snippet: snippetOf(result),
    ...(raceId === undefined ? {} : { raceId }),
    wpm: result.metrics.wpm,
    accuracy: result.metrics.accuracy,
    errors: result.metrics.errors,
    elapsedMs: result.metrics.elapsedMs,
    ranked: result.ranked,
    engineVersion: result.engineVersion,
    engineMode: result.engineMode,
    finishedAt: new Date(at),
  };
}

/**
 * Persists a finished race run. Deliberately not awaited: the racer already
 * has their result, and a slow or broken database must not hold up the race
 * everyone else is still in. The failure is logged rather than swallowed —
 * there is nobody to hand it to, but it must not disappear.
 */
function store(
  database: Db | undefined,
  room: Room,
  result: RunResult,
  player: Player,
  at: number,
): void {
  if (database === undefined) {
    return;
  }
  // Memoised on the room: every racer in a race writes their own run, and all
  // of them point at one race row.
  room.persistedRace ??= recordRace(database, snippetOf(result), {
    code: room.id,
    kind: room.state.kind,
    startedWith: room.state.startedWith ?? 0,
    startedAt: new Date(room.state.startedAt ?? at),
  });

  void room.persistedRace
    .then((raceId) => recordRun(database, runRecordOf(result, player, at, raceId)))
    .catch((error: unknown) => {
      // A race row that failed must not be remembered as done, or every
      // later run in this race would wait on a promise that never resolves.
      room.persistedRace = undefined;
      console.error('failed to store run', error);
    });
}

function isSubmitPayload(value: unknown): value is SubmitPayload {
  if (typeof value !== 'object' || value === null || !('events' in value)) {
    return false;
  }
  const { events } = value;
  return Array.isArray(events) && events.every(isInputEvent) && isPlayer(value);
}

/**
 * An id is required and a name is not. A client that sends no name gets
 * `anon`, which is what `cleanName` would have made of an empty one anyway —
 * a missing name is not a reason to refuse a run someone just finished.
 */
function isPlayer(value: object): boolean {
  const { player } = value as { player?: unknown };
  if (typeof player !== 'object' || player === null) {
    return false;
  }
  const { id, name } = player as { id?: unknown; name?: unknown };
  return (
    typeof id === 'string' &&
    id !== '' &&
    id.length <= 64 &&
    (name === undefined || typeof name === 'string')
  );
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
