import { isLinePreset, LINE_PRESETS } from '@ctr/generator';
import { and, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { firstError, languageSchema } from '../wire.ts';
import type { Db } from './index.ts';
import { runs, snippets } from './schema.ts';

/**
 * The leaderboards. `SPEC.md` settles their shape: two boards, solo and
 * multiplayer, never mixed — solo gets practised far more, and merging would
 * bury every race result. Each is split by language and length preset, ranked
 * by WPM with accuracy as the tiebreaker, one entry per player, in daily and
 * all-time variants.
 */

/**
 * Without a floor the top of the board is whoever spams fastest at 60%.
 * A number, not a setting: a board people can read is worth more than one
 * everybody can tune.
 */
const MIN_ACCURACY = 0.9;

const DEFAULT_LIMIT = 25;

export type BoardKind = 'solo' | 'multiplayer';

export interface BoardQuery {
  readonly kind: BoardKind;
  readonly language: string;
  readonly lines: number;
  /** Only runs finished at or after this. Absent means all time. */
  readonly since?: Date;
  readonly limit?: number;
}

/** Midnight UTC on the day `now` falls in. One day for everybody, rather than
 * a board that reads differently depending on where it is read. */
export function startOfDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const LINES_ERROR = `lines must be one of ${LINE_PRESETS.join(', ')}`;

/**
 * A board request, as it arrives on a query string — where everything is a
 * string, so `lines` is coerced rather than checked. Only the presets have
 * boards: a custom length would give nearly every run a board of its own,
 * which is the same reason a custom-length run is never ranked in the first
 * place.
 */
export const boardQuerySchema = z.object({
  kind: z.enum(['solo', 'multiplayer'], { error: 'kind must be solo or multiplayer' }),
  language: languageSchema,
  // `Number('twenty')` is NaN and `z.number()` refuses NaN, so a word fails
  // here the same way a non-preset number does, with the same message.
  lines: z.coerce
    .number({ error: LINES_ERROR })
    .int({ error: LINES_ERROR })
    .refine(isLinePreset, { error: LINES_ERROR }),
  span: z.enum(['daily', 'all-time'], { error: 'span must be daily or all-time' }).optional(),
});

/** Reads a board request off a query string, dated against `now`. */
export function parseBoardQuery(params: Record<string, unknown>, now: Date): BoardQuery {
  const asked = boardQuerySchema.safeParse(params);
  if (!asked.success) {
    throw new Error(firstError(asked.error));
  }
  const { kind, language, lines, span } = asked.data;

  return {
    kind,
    language,
    lines,
    ...(span === 'daily' ? { since: startOfDay(now) } : {}),
  };
}

export interface BoardEntry {
  readonly playerName: string;
  readonly wpm: number;
  readonly accuracy: number;
  readonly finishedAt: Date;
}

/**
 * Best run per player, ranked by WPM within a language and a length. That
 * sentence is a window function, and `SPEC.md` chose an ORM that lets it look
 * like one rather than hide it.
 */
export async function leaderboard(db: Db, query: BoardQuery): Promise<BoardEntry[]> {
  const best = db
    .select({
      playerName: runs.playerName,
      wpm: runs.wpm,
      accuracy: runs.accuracy,
      finishedAt: runs.finishedAt,
      seat: sql<number>`row_number() over (
        partition by ${runs.playerId}
        order by ${runs.wpm} desc, ${runs.accuracy} desc
      )`.as('seat'),
    })
    .from(runs)
    .innerJoin(snippets, eq(runs.snippetId, snippets.id))
    .where(
      and(
        // `ranked` already carries every condition that depends on how the run
        // happened; this query only adds the ones about the board itself.
        eq(runs.ranked, true),
        gte(runs.accuracy, MIN_ACCURACY),
        eq(snippets.language, query.language),
        eq(snippets.lines, query.lines),
        query.kind === 'solo' ? isNull(runs.raceId) : isNotNull(runs.raceId),
        query.since === undefined ? undefined : gte(runs.finishedAt, query.since),
      ),
    )
    .as('best');

  return db
    .select({
      playerName: best.playerName,
      wpm: best.wpm,
      accuracy: best.accuracy,
      finishedAt: best.finishedAt,
    })
    .from(best)
    .where(eq(best.seat, 1))
    .orderBy(desc(best.wpm), desc(best.accuracy))
    .limit(query.limit ?? DEFAULT_LIMIT);
}
