import { LANGUAGES } from '@ctr/generator';
import { z } from 'zod';

/**
 * The wire schemas: everything a client is allowed to say, and in what shape.
 * Nothing reaches a handler unparsed.
 *
 * They live in `apps/server` and not in `packages/` because a package may not
 * take a dependency, and because what a server accepts is a server's rule —
 * the browser describes what it sends, this decides what is allowed in. They
 * live in their own file rather than beside the sockets because the HTTP
 * routes, the sockets and the board query all need them, and a leaderboard
 * should not have to import the socket module to validate a query string.
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
