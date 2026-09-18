/**
 * Personal bests, kept in localStorage. One best per language and line count,
 * because those are the two things that decide how hard a snippet is to type;
 * a best that mixed 10-line and 35-line runs would compare nothing.
 *
 * No React and no direct `localStorage` reference: the store arrives as an
 * argument, which is what makes this testable and what keeps the browser out
 * of the comparison rules.
 */

import type { Language } from '@ctr/generator';

/** The part of `Storage` this needs. `window.localStorage` satisfies it. */
export interface BestStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/**
 * Bumped if the stored shape ever changes. A record from an older version is
 * discarded rather than migrated — a personal best is cheap to re-earn, and
 * misreading one would show a wrong number forever.
 */
const STORED_VERSION = 1;

export interface Best {
  readonly wpm: number;
  readonly accuracy: number;
  readonly elapsedMs: number;
}

export interface BestOutcome {
  /** The best after this run, which is the run itself when it improved. */
  readonly best: Best;
  /** The best this run was measured against, absent on the first run. */
  readonly previous?: Best;
  readonly improved: boolean;
}

export function bestKey(language: Language, lines: number): string {
  return `ctr.best.${language}.${lines}`;
}

export function readBest(store: BestStore, key: string): Best | undefined {
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    // Reading storage throws outright in Safari's private mode and wherever
    // site data is blocked. A personal best is decoration on a result that is
    // already correct, so there is nothing to report and nothing to retry.
    return undefined;
  }
  if (raw === null) {
    return undefined;
  }

  try {
    return parse(JSON.parse(raw));
  } catch {
    // Anything unparseable is storage written by another version, another
    // tool, or a half-finished write. Discarding it is the whole recovery.
    return undefined;
  }
}

/**
 * Records a finished run and says whether it beat the stored best. Speed alone
 * decides: it is the number the leaderboards will rank on, so the local board
 * and the public one should not disagree about what "better" means.
 */
export function recordBest(store: BestStore, key: string, run: Best): BestOutcome {
  const previous = readBest(store, key);
  const improved = previous === undefined || run.wpm > previous.wpm;
  if (!improved) {
    return { best: previous, previous, improved: false };
  }

  try {
    store.setItem(key, JSON.stringify({ version: STORED_VERSION, ...run }));
  } catch {
    // A full or blocked quota costs the player their history, not their run.
    // The screen still shows the new best; it just will not survive a reload.
  }
  return previous === undefined
    ? { best: run, improved: true }
    : { best: run, previous, improved: true };
}

function parse(value: unknown): Best | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record['version'] !== STORED_VERSION) {
    return undefined;
  }
  const { wpm, accuracy, elapsedMs } = record;
  if (!finite(wpm) || !finite(accuracy) || !finite(elapsedMs)) {
    return undefined;
  }
  return { wpm, accuracy, elapsedMs };
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
