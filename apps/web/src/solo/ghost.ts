/**
 * Ghosts: your last run on a snippet, replayed beside the live one.
 *
 * A ghost is the keystream, which is the same thing the server recomputes a
 * result from — there is no second recording format, so a ghost can only ever
 * be something that really happened.
 *
 * No React and no direct `localStorage` reference: the store arrives as an
 * argument, the same shape `bests.ts` uses and for the same reason.
 */

import type { Language } from '@ctr/generator';
import type { InputEvent } from '@ctr/typing-engine';

/** The part of `Storage` this needs. `window.localStorage` satisfies it. */
export interface GhostStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/**
 * Bumped if the stored shape changes. An older record is discarded rather than
 * migrated: replaying a misread keystream would race you against a run nobody
 * ever typed.
 */
const STORED_VERSION = 1;

/**
 * How many snippets keep a ghost. Seeds are effectively infinite, so without a
 * cap this grows until the quota throws — and a failed write is silent by
 * design, so ghosts would simply stop saving one day with nothing to show for
 * it. The oldest goes instead.
 */
const KEEP = 20;

/** Where the recency order lives, since a store only answers about keys it is asked about. */
const INDEX_KEY = 'ctr.ghosts';

export interface GhostIdentity {
  readonly generatorVersion: number;
  readonly language: Language;
  readonly lines: number;
  readonly seed: number;
}

export interface Ghost {
  readonly wpm: number;
  readonly accuracy: number;
  /** Timestamps relative to the first event, so a ghost is comparable to any
   * later run's elapsed time rather than to the page load that recorded it. */
  readonly events: readonly InputEvent[];
}

/**
 * The full identity, not just the seed: the generator is tuned constantly and
 * every tune silently changes the text behind every existing seed, so a
 * ghost keyed on the seed alone would replay against text that no longer
 * exists.
 */
export function ghostKey({ generatorVersion, language, lines, seed }: GhostIdentity): string {
  return `ctr.ghost.${generatorVersion}.${language}.${lines}.${seed}`;
}

/**
 * Rebases a finished run's keystream onto its own first keystroke. The engine
 * stamps events with `performance.now()`, which counts from a page load the
 * next run will not share.
 */
export function rebase(events: readonly InputEvent[]): readonly InputEvent[] {
  const first = events[0];
  if (first === undefined) {
    return [];
  }
  return events.map((event) => ({ ...event, at: event.at - first.at }));
}

/**
 * Where the ghost had got to after `elapsedMs`, as a fraction of `total`
 * typeable characters. Pure and clockless — the caller supplies the elapsed
 * time, which is the same one the live run is measured against.
 *
 * Replays the real timings rather than a smooth average pace, so the ghost
 * hesitates exactly where you hesitated.
 */
export function ghostProgress(
  events: readonly InputEvent[],
  elapsedMs: number,
  total: number,
): number {
  if (total <= 0) {
    return 0;
  }
  let cursor = 0;
  for (const event of events) {
    if (event.at > elapsedMs) {
      break;
    }
    if (event.kind === 'backspace') {
      cursor = Math.max(0, cursor - 1);
    } else {
      // Permissive mode: a wrong character still advances. The engine charges
      // it to accuracy, not to position, so the bar moves either way.
      cursor += 1;
    }
  }
  return Math.min(1, cursor / total);
}

export function readGhost(store: GhostStore, key: string): Ghost | undefined {
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    // Reading throws outright in Safari's private mode and wherever site data
    // is blocked. A ghost is an optional opponent; there is nothing to report
    // and nothing to retry.
    return undefined;
  }
  if (raw === null) {
    return undefined;
  }

  try {
    return parse(JSON.parse(raw));
  } catch {
    // Unparseable storage is another version, another tool, or a half-finished
    // write. Discarding it is the whole recovery.
    return undefined;
  }
}

/**
 * Stores this run as the ghost for its snippet, replacing whatever was there.
 * One ghost per snippet, last run only — there is no pool and no history.
 */
export function saveGhost(store: GhostStore, key: string, ghost: Ghost): void {
  try {
    store.setItem(key, JSON.stringify({ version: STORED_VERSION, ...ghost }));
  } catch {
    // A full or blocked quota costs the player an opponent, not their run. The
    // result on screen is unaffected; there is just nothing to race next time.
    return;
  }
  promote(store, key);
}

/** Moves `key` to the front of the recency order and drops what falls off it. */
function promote(store: GhostStore, key: string): void {
  const kept = [key, ...readIndex(store).filter((existing) => existing !== key)];
  for (const evicted of kept.slice(KEEP)) {
    try {
      store.removeItem(evicted);
    } catch {
      // Dropping the record is the point of the cap, but failing to drop it
      // only means the quota is reached sooner. The index below is still
      // truncated, so the same key is never evicted twice.
    }
  }
  try {
    store.setItem(
      INDEX_KEY,
      JSON.stringify({ version: STORED_VERSION, keys: kept.slice(0, KEEP) }),
    );
  } catch {
    // Same as a failed ghost write: the ghost that was just stored still
    // works, it just is not counted against the cap.
  }
}

function readIndex(store: GhostStore): readonly string[] {
  let raw: string | null;
  try {
    raw = store.getItem(INDEX_KEY);
  } catch {
    return [];
  }
  if (raw === null) {
    return [];
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) {
      return [];
    }
    const record = value as Record<string, unknown>;
    if (record['version'] !== STORED_VERSION || !Array.isArray(record['keys'])) {
      return [];
    }
    return record['keys'].filter((entry): entry is string => typeof entry === 'string');
  } catch {
    // An unreadable index costs the cap, not a ghost: every key still reads on
    // its own. Starting over is the recovery.
    return [];
  }
}

function parse(value: unknown): Ghost | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record['version'] !== STORED_VERSION) {
    return undefined;
  }
  const { wpm, accuracy, events } = record;
  if (!finite(wpm) || !finite(accuracy) || !Array.isArray(events)) {
    return undefined;
  }
  const replay: InputEvent[] = [];
  for (const event of events) {
    const parsed = parseEvent(event);
    if (parsed === undefined) {
      // One bad event makes every later position wrong, so the ghost goes
      // rather than the event.
      return undefined;
    }
    replay.push(parsed);
  }
  return { wpm, accuracy, events: replay };
}

function parseEvent(value: unknown): InputEvent | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const { kind, at } = record;
  if (!finite(at)) {
    return undefined;
  }
  if (kind === 'backspace') {
    return { kind, at };
  }
  if (kind === 'char' && typeof record['char'] === 'string') {
    return { kind, char: record['char'], at };
  }
  return undefined;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
