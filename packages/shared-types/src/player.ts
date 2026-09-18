/**
 * Who a run belongs to, and what a name is allowed to be.
 *
 * These rules are shared because both sides need them and neither may be the
 * only one that has them: the browser needs them offline to show the name it
 * will send, and the server needs them because a name goes onto a public board
 * and nothing off the wire is trusted. Two copies would drift, and the drift
 * would show as a name rendering differently on the board than in the header.
 */

export interface Player {
  /** An anonymous id from the player's browser. There are no accounts. */
  readonly id: string;
  readonly name: string;
}

export const NAME_MAX = 20;

/** What is left when a name is nothing but spaces or forbidden characters. */
export const ANONYMOUS = 'anon';

/**
 * Letters, digits, and a few separators. Deliberately narrow: everything
 * outside it — combining marks, right-to-left overrides, emoji, zero-width
 * joiners — is a way to make one row of a board wreck the rest of it.
 */
const ALLOWED = /[^\p{L}\p{N} _-]/gu;

/**
 * Trims, strips what is not allowed, collapses runs of spaces, and truncates.
 * Never fails: a name that survives none of that becomes `anon`, because
 * refusing a run over its name would be a worse answer than renaming it.
 */
export function cleanName(raw: string): string {
  const cleaned = raw.replace(ALLOWED, '').replace(/\s+/gu, ' ').trim().slice(0, NAME_MAX).trim();
  return cleaned === '' ? ANONYMOUS : cleaned;
}
