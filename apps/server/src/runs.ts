import { generateSnippet, GENERATOR_VERSION, isLinePreset } from '@ctr/generator';
import {
  DEFAULT_MODE,
  ENGINE_VERSION,
  isFinished,
  measure,
  replay,
  type InputEvent,
} from '@ctr/typing-engine';
import { z } from 'zod';
import type { VerifiedRun } from './io.ts';
import { firstError, keystreamSchema, languageSchema, linesSchema, playerSchema } from './wire.ts';

/**
 * Solo runs. A race arrives over a socket and the server already knows its
 * snippet; a solo run arrives over HTTP and has to name the snippet it claims
 * to have typed — but only by its identity, never by its text, so the server
 * generates the text itself and the client cannot choose what it raced on.
 */

/** The largest seed the client draws, matching `crypto.getRandomValues`. */
const MAX_SEED = 2 ** 32 - 1;

const SEED_ERROR = 'seed must be a non-negative 32-bit integer';

/**
 * A finished solo run as it arrives. The snippet is named by its identity and
 * never by its text: the server generates the text itself from these three
 * fields, so a client cannot choose what it claims to have raced on.
 */
export const soloSubmissionSchema = z.object(
  {
    language: languageSchema,
    lines: linesSchema,
    seed: z
      .number({ error: SEED_ERROR })
      .int({ error: SEED_ERROR })
      .min(0, { error: SEED_ERROR })
      .max(MAX_SEED, { error: SEED_ERROR }),
    player: playerSchema,
    events: keystreamSchema,
  },
  { error: 'expected an object' },
);

export type SoloSubmission = z.infer<typeof soloSubmissionSchema>;

/**
 * Reads a solo submission off the wire. Throws with a message meant for the
 * client: a rejected run should say which field was wrong, because the only
 * person who ever sees it is someone whose run just vanished.
 */
export function parseSolo(body: unknown): SoloSubmission {
  const sent = soloSubmissionSchema.safeParse(body);
  if (!sent.success) {
    throw new Error(firstError(sent.error));
  }
  return sent.data;
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
