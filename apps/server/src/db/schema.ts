import {
  boolean,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Three tables, as `SPEC.md` names them. The shape follows two rules already
 * settled elsewhere: a snippet is identified by
 * `(generatorVersion, language, lines, seed)` and nothing else, and every run
 * records how it was produced — because if the backspace flag ever becomes a
 * setting, runs under different modes are not comparable and nothing would
 * tell them apart after the fact.
 */

/**
 * The text is not stored. It is a pure function of these four columns, so
 * storing it would be a second copy that can disagree with the generator.
 */
export const snippets = pgTable(
  'snippets',
  {
    id: serial('id').primaryKey(),
    generatorVersion: integer('generator_version').notNull(),
    language: text('language').notNull(),
    lines: integer('lines').notNull(),
    seed: integer('seed').notNull(),
  },
  (table) => [
    unique('snippets_identity').on(table.generatorVersion, table.language, table.lines, table.seed),
  ],
);

export const races = pgTable('races', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** The room code. Not the key: codes are reused once a room is swept up. */
  code: text('code').notNull(),
  /** `public` or `private`. A private room's results never reach a board. */
  kind: text('kind').notNull(),
  /**
   * How many racers the race started with, recorded at the countdown, not
   * counted at the end — someone who quits is removed, and counting survivors
   * would under-report what actually happened.
   */
  startedWith: integer('started_with').notNull(),
  snippetId: integer('snippet_id')
    .notNull()
    .references(() => snippets.id),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
});

export const runs = pgTable('runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** The anonymous id from the player's browser. There are no accounts. */
  playerId: text('player_id').notNull(),
  /** Denormalised on purpose: a board shows the name as it was raced under. */
  playerName: text('player_name').notNull(),
  snippetId: integer('snippet_id')
    .notNull()
    .references(() => snippets.id),
  /** Null is a solo run. The two boards are never mixed. */
  raceId: uuid('race_id').references(() => races.id),
  wpm: real('wpm').notNull(),
  accuracy: real('accuracy').notNull(),
  errors: integer('errors').notNull(),
  elapsedMs: integer('elapsed_ms').notNull(),
  /** Whether this result may reach a board at all. */
  ranked: boolean('ranked').notNull(),
  engineVersion: integer('engine_version').notNull(),
  engineMode: text('engine_mode').notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
});
