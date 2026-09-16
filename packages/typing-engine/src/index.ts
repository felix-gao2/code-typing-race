/**
 * The typing engine: `(target text, input events) -> per-character state,
 * progress, WPM, accuracy, errors`.
 *
 * No DOM, no React, no network, no clock. Three consumers run this same code —
 * the solo page, the race page, and the server recomputing a submitted run —
 * and they must not be able to disagree.
 */

export { compare, advances, type EngineMode, type Outcome } from './compare.ts';
export {
  isFinished,
  replay,
  start,
  step,
  type CharState,
  type CharStatus,
  type InputEvent,
  type RunState,
} from './engine.ts';
export { measure, type RunMetrics } from './metrics.ts';
export { mapTarget, type TargetMap, type TypeableChar } from './target.ts';

/**
 * Bump when a keystream stops producing the same result — a change to the
 * comparison, the flattening, or the scoring. Runs record it alongside
 * `generatorVersion`, so a stored keystream can always be told which rules it
 * was typed under.
 */
export const ENGINE_VERSION = 1;

/**
 * Permissive: wrong characters are taken and marked, and backspace fixes them.
 * Blocking is implemented and switchable; this is the one the game is played
 * in until playing it says otherwise.
 */
export const DEFAULT_MODE = 'permissive' as const;
