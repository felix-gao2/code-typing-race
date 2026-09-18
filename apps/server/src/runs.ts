import {
  generateSnippet,
  GENERATOR_VERSION,
  isLinePreset,
  LANGUAGES,
  type Language,
} from '@ctr/generator';
import type { Player } from '@ctr/shared-types';
import {
  DEFAULT_MODE,
  ENGINE_VERSION,
  isFinished,
  measure,
  replay,
  type InputEvent,
} from '@ctr/typing-engine';
import { isInputEvent, isPlayer, type VerifiedRun } from './io.ts';

/**
 * Solo runs. A race arrives over a socket and the server already knows its
 * snippet; a solo run arrives over HTTP and has to name the snippet it claims
 * to have typed — but only by its identity, never by its text, so the server
 * generates the text itself and the client cannot choose what it raced on.
 */

/** The largest seed the client draws, matching `crypto.getRandomValues`. */
const MAX_SEED = 2 ** 32 - 1;

/** Long enough for the longest preset, short enough to refuse a flood. */
const MAX_EVENTS = 20_000;

export interface SoloSubmission {
  readonly language: Language;
  readonly lines: number;
  readonly seed: number;
  readonly player: Player;
  readonly events: readonly InputEvent[];
}

/**
 * Reads a solo submission off the wire. Throws with a message meant for the
 * client: a rejected run should say which field was wrong, because the only
 * person who ever sees it is someone whose run just vanished.
 */
export function parseSolo(body: unknown): SoloSubmission {
  if (typeof body !== 'object' || body === null) {
    throw new Error('expected an object');
  }
  const { language, lines, seed, events } = body as Record<string, unknown>;

  if (typeof language !== 'string' || !LANGUAGES.includes(language as Language)) {
    throw new Error(`language must be one of ${LANGUAGES.join(', ')}`);
  }
  if (typeof lines !== 'number' || !Number.isInteger(lines) || lines < 1 || lines > 200) {
    throw new Error('lines must be an integer between 1 and 200');
  }
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new Error('seed must be a non-negative 32-bit integer');
  }
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('events must be a non-empty array');
  }
  if (events.length > MAX_EVENTS) {
    throw new Error(`events must hold at most ${MAX_EVENTS} entries`);
  }
  if (!events.every(isInputEvent)) {
    throw new Error('events must all be keystrokes');
  }
  if (!isPlayer(body)) {
    throw new Error('player must carry an id');
  }
  const { player } = body as { player: Player };

  return { language: language as Language, lines, seed, player, events };
}

/**
 * Recomputes a solo run. Same replay as a race, against a snippet regenerated
 * from the identity the client sent — if the keystream does not finish that
 * text, the submission is not a finished run of it and is refused.
 */
export function verifySolo(submission: SoloSubmission): VerifiedRun {
  const text = generateSnippet({
    seed: submission.seed,
    language: submission.language,
    lines: submission.lines,
  });
  const state = replayAgainst(text, submission.events);
  if (!isFinished(state)) {
    throw new Error('submitted keystream does not finish the snippet');
  }
  return {
    // A solo run has no race to be ranked by, so the only condition left is
    // the length: a custom length would give every run a board of its own.
    ranked: isLinePreset(submission.lines),
    metrics: measure(state),
    generatorVersion: GENERATOR_VERSION,
    engineVersion: ENGINE_VERSION,
    seed: submission.seed,
    language: submission.language,
    lines: submission.lines,
    engineMode: DEFAULT_MODE,
  };
}

/**
 * Replays a keystream, turning the engine's own refusals into one answer the
 * client can act on. The engine throws on a keystroke past the end of the
 * text, which is exactly what a keystream recorded against a different snippet
 * looks like when that snippet was longer — a bad submission, not a crash.
 */
function replayAgainst(text: string, events: readonly InputEvent[]) {
  try {
    return replay(text, events, DEFAULT_MODE);
  } catch (cause) {
    throw new Error('submitted keystream is not a run of this snippet', { cause });
  }
}
