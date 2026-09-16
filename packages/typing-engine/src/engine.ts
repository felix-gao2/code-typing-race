/**
 * The run state machine. Pure and clock-free: time arrives on the events, and
 * the same target plus the same keystream always produces the same state.
 * That is what lets the server recompute a result from a submitted keystream
 * instead of believing a client-reported one, and what lets a ghost be nothing
 * more than the keystream played again.
 */

import { advances, compare, type EngineMode } from './compare.ts';
import { mapTarget, type TargetMap } from './target.ts';

export type InputEvent =
  /** One character produced by the input surface. A line break is `'\n'`. */
  | { readonly kind: 'char'; readonly char: string; readonly at: number }
  | { readonly kind: 'backspace'; readonly at: number };

export type CharStatus = 'untyped' | 'correct' | 'wrong';

export interface CharState {
  readonly status: CharStatus;
  /**
   * True once this position has been typed wrong, and it stays true after a
   * correction. Accuracy charges for the mistake permanently; keeping the flag
   * is also what lets the forgiving variant be derived later without re-running
   * the keystream.
   */
  readonly everWrong: boolean;
}

export interface RunState {
  readonly target: TargetMap;
  readonly mode: EngineMode;
  /** Index of the character the caret is on. Equals the length when done. */
  readonly cursor: number;
  readonly chars: readonly CharState[];
  /** Character keystrokes only; backspaces are not keystrokes for accuracy. */
  readonly correctKeystrokes: number;
  readonly incorrectKeystrokes: number;
  /** Timestamp of the first character keystroke, per "timer starts on typing". */
  readonly startedAt: number | undefined;
  /** Timestamp of the keystroke that reached the end. */
  readonly finishedAt: number | undefined;
  /** Timestamp of the most recent event, for rejecting impossible keystreams. */
  readonly lastEventAt: number | undefined;
}

const UNTYPED: CharState = { status: 'untyped', everWrong: false };

export function isFinished(state: RunState): boolean {
  return state.cursor >= state.chars.length;
}

export function start(text: string, mode: EngineMode): RunState {
  const target = mapTarget(text);
  if (target.chars.length === 0) {
    throw new Error('start: the target has no typeable characters');
  }
  return {
    target,
    mode,
    cursor: 0,
    chars: target.chars.map(() => UNTYPED),
    correctKeystrokes: 0,
    incorrectKeystrokes: 0,
    startedAt: undefined,
    finishedAt: undefined,
    lastEventAt: undefined,
  };
}

export function step(state: RunState, event: InputEvent): RunState {
  if (!Number.isFinite(event.at)) {
    throw new Error(`step: event timestamp is not a finite number (${String(event.at)})`);
  }
  if (state.lastEventAt !== undefined && event.at < state.lastEventAt) {
    // Physically impossible: a keystroke cannot land before the one before it.
    // A submitted keystream that does this is corrupt or forged, and silently
    // sorting it would launder exactly what the recompute exists to catch.
    throw new Error(
      `step: event at ${event.at} arrives before the previous event at ${state.lastEventAt}`,
    );
  }
  if (isFinished(state)) {
    throw new Error('step: the run is already finished');
  }

  const stamped = { ...state, lastEventAt: event.at };

  if (event.kind === 'backspace') {
    if (state.cursor === 0) {
      // Legitimate — people lean on backspace at the start of a run. It moves
      // nothing and is not a keystroke, but it is still part of the stream.
      return stamped;
    }
    const cursor = state.cursor - 1;
    const chars = [...state.chars];
    // Safe: cursor is in range, having just been decremented from above zero.
    const previous = chars[cursor] as CharState;
    chars[cursor] = { status: 'untyped', everWrong: previous.everWrong };
    return { ...stamped, cursor, chars };
  }

  // Safe: the cursor is in range while the run is unfinished.
  const expected = state.target.chars[state.cursor] as { readonly char: string };
  const outcome = compare(expected.char, event.char, state.mode);
  const chars = [...state.chars];
  // Safe: same bound as above.
  const current = chars[state.cursor] as CharState;

  if (outcome === 'correct') {
    chars[state.cursor] = { status: 'correct', everWrong: current.everWrong };
  } else {
    // A refused keystroke leaves the position untyped but still records that it
    // was fumbled, so blocking runs are not silently perfect.
    chars[state.cursor] = {
      status: outcome === 'wrong' ? 'wrong' : current.status,
      everWrong: true,
    };
  }

  const cursor = advances(outcome) ? state.cursor + 1 : state.cursor;
  const next: RunState = {
    ...stamped,
    cursor,
    chars,
    correctKeystrokes: state.correctKeystrokes + (outcome === 'correct' ? 1 : 0),
    incorrectKeystrokes: state.incorrectKeystrokes + (outcome === 'correct' ? 0 : 1),
    startedAt: state.startedAt ?? event.at,
  };

  return cursor >= chars.length ? { ...next, finishedAt: event.at } : next;
}

/** Replays a whole keystream. This is what the server runs on submission. */
export function replay(text: string, events: readonly InputEvent[], mode: EngineMode): RunState {
  return events.reduce(step, start(text, mode));
}
