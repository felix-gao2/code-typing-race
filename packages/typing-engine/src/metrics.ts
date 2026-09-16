/**
 * Everything a run is scored on. Derived from `RunState` alone, so the server
 * recomputing from a keystream and the client showing a live number are
 * running the same arithmetic.
 */

import type { RunState } from './engine.ts';

/** Standard: a word is five characters. Comparable to every other typing site. */
const CHARS_PER_WORD = 5;
const MS_PER_MINUTE = 60_000;

export interface RunMetrics {
  /** Share of the target reached, 0–1. */
  readonly progress: number;
  readonly elapsedMs: number;
  /**
   * Characters correct in the final text ÷ 5, per minute. A fixed mistake
   * still counts toward speed — the run really did produce that text — and is
   * charged to accuracy instead.
   *
   * Indentation is never typed and so never counted, which is deliberate and
   * does mean a Python run scores over fewer keystrokes than a Java one of the
   * same length.
   */
  readonly wpm: number;
  /** Correct keystrokes ÷ all keystrokes, 0–1. Corrections never refund. */
  readonly accuracy: number;
  readonly errors: number;
}

export function measure(state: RunState, now?: number): RunMetrics {
  const end = state.finishedAt ?? now;
  if (end === undefined) {
    throw new Error('measure: an unfinished run needs the current time to be measured');
  }

  const elapsedMs = state.startedAt === undefined ? 0 : Math.max(0, end - state.startedAt);
  const correctChars = state.chars.filter((c) => c.status === 'correct').length;
  const keystrokes = state.correctKeystrokes + state.incorrectKeystrokes;

  return {
    progress: state.cursor / state.chars.length,
    elapsedMs,
    // A run with no elapsed time has no meaningful speed. Reporting zero beats
    // dividing by it and ranking an Infinity.
    wpm: elapsedMs === 0 ? 0 : correctChars / CHARS_PER_WORD / (elapsedMs / MS_PER_MINUTE),
    accuracy: keystrokes === 0 ? 1 : state.correctKeystrokes / keystrokes,
    errors: state.incorrectKeystrokes,
  };
}
