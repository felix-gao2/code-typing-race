import type { InputEvent } from '@ctr/typing-engine';

/**
 * Translates a DOM `beforeinput` into engine events.
 *
 * The input surface listens on `beforeinput` rather than `keydown` because
 * `keydown` cannot see dead keys — on a US-International layout `"`, `'`,
 * `` ` ``, `^` and `~` all arrive composed, and all five are high-frequency in
 * code. It also sidesteps Firefox's quick-find on `'` and `/`.
 *
 * Pure, so the whole translation is testable without a browser.
 */

/** The parts of a `beforeinput` event this depends on. */
export interface InputIntent {
  readonly inputType: string;
  readonly data: string | null;
}

export function toEvents(intent: InputIntent, at: number): InputEvent[] {
  switch (intent.inputType) {
    case 'insertText':
      // One event per character: an IME or an autocomplete can deliver several
      // at once, and the engine scores characters, not insertions.
      return intent.data === null
        ? []
        : [...intent.data].map((char) => ({ kind: 'char', char, at }));

    case 'insertLineBreak':
    case 'insertParagraph':
      // Enter. The engine treats a line break as an ordinary typeable
      // character, so it needs no special handling beyond naming it.
      return [{ kind: 'char', char: '\n', at }];

    case 'deleteContentBackward':
      return [{ kind: 'backspace', at }];

    // Paste is blocked by product decision — the one anti-cheat measure that
    // is not deferred. Returning nothing, with the caller preventing default,
    // is what blocks it.
    case 'insertFromPaste':
    case 'insertFromDrop':
    case 'insertFromYank':
    case 'insertFromPasteAsQuotation':
      return [];

    default:
      // Everything else is refused rather than guessed at. Notably
      // `deleteWordBackward` (ctrl-backspace): the engine has no notion of a
      // word, and deleting one character when the user asked for a word would
      // be a worse answer than doing nothing. Open question, not an oversight.
      return [];
  }
}
