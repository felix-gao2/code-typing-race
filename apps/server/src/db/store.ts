import { and, eq } from 'drizzle-orm';
import type { Db } from './index.ts';
import { races, runs, snippets } from './schema.ts';

/**
 * Writing results. Everything here is called with a result the server already
 * recomputed from a keystream, so nothing in this file validates anything —
 * by the time a record reaches it, it is true.
 */

export interface SnippetIdentity {
  readonly generatorVersion: number;
  readonly language: string;
  readonly lines: number;
  readonly seed: number;
}

export interface RaceIdentity {
  /** The room code, which is not unique over time — rooms are swept up. */
  readonly code: string;
  readonly kind: string;
  readonly startedWith: number;
  readonly startedAt: Date;
}

export interface RunRecord {
  readonly playerId: string;
  readonly playerName: string;
  readonly snippet: SnippetIdentity;
  /** Absent for a solo run. The two boards are never mixed. */
  readonly raceId?: string;
  readonly wpm: number;
  readonly accuracy: number;
  readonly errors: number;
  readonly elapsedMs: number;
  readonly ranked: boolean;
  readonly engineVersion: number;
  readonly engineMode: string;
  readonly finishedAt: Date;
}

/**
 * The row for a snippet, inserted if this is the first run on it. Two racers
 * finishing at once race for the insert, which is what the unique constraint
 * on the identity is for: the loser reads the winner's row.
 */
export async function ensureSnippet(db: Db, identity: SnippetIdentity): Promise<number> {
  const inserted = await db.insert(snippets).values(identity).onConflictDoNothing().returning({
    id: snippets.id,
  });
  const first = inserted[0];
  if (first !== undefined) {
    return first.id;
  }

  const existing = await db
    .select({ id: snippets.id })
    .from(snippets)
    .where(
      and(
        eq(snippets.generatorVersion, identity.generatorVersion),
        eq(snippets.language, identity.language),
        eq(snippets.lines, identity.lines),
        eq(snippets.seed, identity.seed),
      ),
    );
  const row = existing[0];
  if (row === undefined) {
    // The insert conflicted, so a row matching this identity exists; not
    // finding it means the identity columns and the constraint disagree.
    throw new Error('snippet conflicted on insert but could not be read back');
  }
  return row.id;
}

/** The row for a race. Called once per race, when it starts. */
export async function recordRace(
  db: Db,
  snippet: SnippetIdentity,
  race: RaceIdentity,
): Promise<string> {
  const snippetId = await ensureSnippet(db, snippet);
  const inserted = await db
    .insert(races)
    .values({ ...race, snippetId })
    .returning({ id: races.id });
  const row = inserted[0];
  if (row === undefined) {
    throw new Error('race insert returned no row');
  }
  return row.id;
}

export async function recordRun(db: Db, record: RunRecord): Promise<void> {
  const snippetId = await ensureSnippet(db, record.snippet);
  await db.insert(runs).values({
    playerId: record.playerId,
    playerName: record.playerName,
    snippetId,
    raceId: record.raceId ?? null,
    wpm: record.wpm,
    accuracy: record.accuracy,
    errors: record.errors,
    elapsedMs: record.elapsedMs,
    ranked: record.ranked,
    engineVersion: record.engineVersion,
    engineMode: record.engineMode,
    finishedAt: record.finishedAt,
  });
}
