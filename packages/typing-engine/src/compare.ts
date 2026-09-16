/**
 * The whole of the backspace/error behaviour difference. Both modes exist
 * because which one feels right has to be played, not argued, so switching is
 * a config change and never a rewrite.
 *
 * Nothing else in the package may branch on `EngineMode`. If a second place
 * needs to know the mode, the decision has leaked and belongs back here.
 */

export type EngineMode = 'permissive' | 'blocking';

/** What a character keystroke does to the run. */
export type Outcome =
  /** Matches: record it and advance. */
  | 'correct'
  /** Wrong, but taken anyway and marked — permissive only. */
  | 'wrong'
  /** Wrong and refused; the caret stays put — blocking only. */
  | 'rejected';

/**
 * `expected` is the character the caret is on. A line break is `'\n'`, so
 * Enter pressed mid-line arrives here as an ordinary mismatch rather than as
 * its own rule.
 */
export function compare(expected: string, typed: string, mode: EngineMode): Outcome {
  if (typed === expected) {
    return 'correct';
  }
  return mode === 'permissive' ? 'wrong' : 'rejected';
}

/**
 * Whether the caret moves. Kept next to `compare` so the two halves of the
 * decision cannot drift apart.
 */
export function advances(outcome: Outcome): boolean {
  return outcome !== 'rejected';
}
