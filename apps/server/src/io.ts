import { GENERATOR_VERSION, isLinePreset, LANGUAGES } from '@ctr/generator';
import type { RaceState } from '@ctr/race-machine';
import {
  DEFAULT_MODE,
  ENGINE_VERSION,
  isFinished,
  measure,
  replay,
  type RunMetrics,
} from '@ctr/typing-engine';
import { ANONYMOUS, cleanName } from '@ctr/shared-types';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
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

/**
 * The wire schemas. They live here, and not in `packages/`, because a package
 * may not take a dependency and because what a server accepts is a server's
 * rule: the browser describes what it sends, this decides what is allowed in.
 * Every message below is parsed through one of these before anything else
 * looks at it.
 *
 * The messages are written for the client, not for a log. Someone reading one
 * has just had a run refused, and "seed must be a non-negative 32-bit integer"
 * tells them something that "Invalid input" does not.
 */

const LINES_ERROR = 'lines must be an integer between 1 and 200';

/** Shared by every route that names a snippet: a race, a room, a solo run. */
export const languageSchema = z.enum(LANGUAGES, {
  error: `language must be one of ${LANGUAGES.join(', ')}`,
});

/**
 * Any length is playable and only the presets are ranked, so the bound here is
 * not about boards — it is so that a request cannot ask the generator for ten
 * thousand lines of work.
 */
export const linesSchema = z
  .number({ error: LINES_ERROR })
  .int({ error: LINES_ERROR })
  .min(1, { error: LINES_ERROR })
  .max(200, { error: LINES_ERROR });

/**
 * Opening a room and asking for a public match are the same two fields. The
 * message on the object itself is for a request that sent no body at all,
 * which would otherwise be answered in Zod's words rather than ours.
 */
export const raceRequestSchema = z.object(
  { language: languageSchema, lines: linesSchema },
  { error: 'expected a language and a line count' },
);

const KEYSTROKE_ERROR = 'events must all be keystrokes';

/**
 * One keystroke. Every field repeats the same message on purpose: once the
 * `kind` matches, Zod reports the field's own complaint rather than the
 * union's, and to whoever sent it a missing `char` and an unknown `kind` are
 * one mistake. Naming which of the two shapes it failed to be would explain
 * nothing to a client that meant to send neither.
 *
 * `z.number()` rejects NaN and Infinity on its own, which is what the
 * hand-rolled `Number.isFinite` check was for.
 */
const inputEventSchema = z.discriminatedUnion(
  'kind',
  [
    z.object({
      kind: z.literal('char'),
      char: z.string({ error: KEYSTROKE_ERROR }).min(1, { error: KEYSTROKE_ERROR }),
      at: z.number({ error: KEYSTROKE_ERROR }),
    }),
    z.object({ kind: z.literal('backspace'), at: z.number({ error: KEYSTROKE_ERROR }) }),
  ],
  { error: KEYSTROKE_ERROR },
);

/** The longest preset is a few hundred keystrokes; this refuses a flood. */
const MAX_EVENTS = 20_000;

/** A whole run: the only thing a client can send that the server can check. */
export const keystreamSchema = z
  .array(inputEventSchema)
  .min(1, { error: 'events must be a non-empty array' })
  .max(MAX_EVENTS, { error: `events must hold at most ${MAX_EVENTS} entries` });

const PLAYER_ERROR = 'player must carry an id';

/**
 * Who to credit a run to. An id is required and a name is not: a client that
 * sends no name gets `anon`, which is what `cleanName` would have made of an
 * empty one anyway — a missing name is not a reason to refuse a run someone
 * just finished. The name is cleaned again on the way in, because it goes onto
 * a public board and it is the one field a client chooses the text of.
 */
export const playerSchema = z.object(
  {
    id: z
      .string({ error: PLAYER_ERROR })
      .min(1, { error: PLAYER_ERROR })
      .max(64, { error: PLAYER_ERROR }),
    name: z.string({ error: PLAYER_ERROR }).optional(),
  },
  { error: PLAYER_ERROR },
);

/**
 * A player as it arrives, where the name may be missing. `Player` in
 * `shared-types` is what the browser holds and always has both; this is the
 * wire's version of it, and the difference is exactly the `?? ANONYMOUS` in
 * `runRecordOf`.
 */
export type WirePlayer = z.infer<typeof playerSchema>;

/** What a racer sends when they think they are done. */
export const submitPayloadSchema = z.object(
  { events: keystreamSchema, player: playerSchema },
  { error: 'expected a keystream and a player' },
);

export type SubmitPayload = z.infer<typeof submitPayloadSchema>;

/**
 * Zod's own `Error.message` is a JSON dump of every issue. A client gets one
 * sentence naming one field instead, which is all it can act on.
 */
export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'invalid request';
}

/**
 * A run the server recomputed and believes. A solo run is exactly this; a race
 * run is this plus which racer it belonged to.
 */
export interface VerifiedRun {
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

/** The verified result of a race run, as the server computed it. */
export interface RunResult extends VerifiedRun {
  readonly racerId: string;
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
  // The engine refuses a keystroke past the end of the text, so a keystream
  // longer than this snippet arrives here as a throw rather than as an
  // unfinished run. Either way it is a bad submission, and the caller turns
  // this into an answer for the racer rather than a crash.
  let state;
  try {
    state = replay(room.state.text, payload.events, DEFAULT_MODE);
  } catch (cause) {
    throw new Error('submitted keystream is not a run of this snippet', { cause });
  }
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

    socket.on('join', (raw: unknown, ack?: (response: unknown) => void) => {
      const asked = z.string().safeParse(raw);
      if (!asked.success || joined !== undefined) {
        ack?.({ ok: false, error: 'bad join' });
        return;
      }
      const roomId = asked.data;
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
      const asked = raceRequestSchema.safeParse(request ?? {});
      if (!asked.success) {
        ack?.({ ok: false, error: firstError(asked.error) });
        return;
      }
      const room = matchmaker.find(asked.data, now());
      ack?.({ ok: true, id: room.id });
    });

    socket.on('progress', (value: unknown) => {
      const reported = z.number().safeParse(value);
      if (joined === undefined || !reported.success) {
        return;
      }
      // Advisory only: this moves a progress bar and nothing else. The machine
      // clamps it, and the result that counts is recomputed on submit.
      const moved = rooms.dispatch(joined.roomId, {
        type: 'progress',
        id: joined.racerId,
        progress: reported.data,
        at: now(),
      });
      if (moved !== undefined) {
        broadcast(moved);
      }
    });

    socket.on('submit', (raw: unknown, ack?: (response: unknown) => void) => {
      const sent = submitPayloadSchema.safeParse(raw);
      if (joined === undefined || !sent.success) {
        ack?.({ ok: false, error: 'bad submission' });
        return;
      }
      const payload = sent.data;
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
export function snippetOf(result: VerifiedRun): SnippetIdentity {
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
  result: VerifiedRun,
  player: WirePlayer,
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
  player: WirePlayer,
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
