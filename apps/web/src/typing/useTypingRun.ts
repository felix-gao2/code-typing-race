import {
  DEFAULT_MODE,
  isFinished,
  measure,
  start,
  step,
  type InputEvent,
  type RunMetrics,
  type RunState,
} from '@ctr/typing-engine';
import { useCallback, useEffect, useState } from 'react';
import { toEvents, type InputIntent } from '../solo/input.ts';

/**
 * One run of one piece of text. Solo supplies the text by generating it; a
 * race is handed the text by the server. Everything past that point — the
 * keystream, the live clock, when a run is over — is identical, so it lives
 * here rather than in both.
 */

/** How often the live WPM refreshes while typing. */
const TICK_MS = 100;

export interface TypingRun {
  readonly state: RunState;
  readonly metrics: RunMetrics;
  readonly finished: boolean;
  /** Feed a `beforeinput`. Returns nothing; the caller prevents the default. */
  readonly handleInput: (intent: InputIntent) => void;
  /**
   * Every event of this run, in order. This is what the server recomputes the
   * result from — the client's own numbers are never the ones that count.
   */
  readonly keystream: readonly InputEvent[];
}

interface RunSlot {
  readonly key: string;
  readonly state: RunState;
  /** Held beside the state rather than in a ref, so it resets with the run and
   * is never read while a render is in flight. */
  readonly keystream: readonly InputEvent[];
}

function fresh(key: string, text: string): RunSlot {
  return { key, state: start(text, DEFAULT_MODE), keystream: [] };
}

/**
 * @param text the target
 * @param key changes whenever the run should restart, even if the text did not
 */
export function useTypingRun(text: string, key: string): TypingRun {
  const [run, setRun] = useState(() => fresh(key, text));

  if (run.key !== key) {
    // Resetting during render rather than in an effect, so no frame is ever
    // painted with the previous run's characters under the new text.
    setRun(fresh(key, text));
  }

  const finished = isFinished(run.state);
  const started = run.state.startedAt !== undefined;

  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!started || finished) {
      return undefined;
    }
    const id = setInterval(() => setNow(performance.now()), TICK_MS);
    return () => clearInterval(id);
  }, [started, finished]);

  const handleInput = useCallback((intent: InputIntent) => {
    // The engine never reads a clock, so the surface stamps the events. It is
    // monotonic, which is what the engine requires of a keystream.
    const events = toEvents(intent, performance.now());
    if (events.length === 0) {
      return;
    }
    setRun((previous) => {
      let state = previous.state;
      const taken: InputEvent[] = [];
      for (const event of events) {
        // A single insertion can carry more characters than the run has left.
        if (isFinished(state)) {
          break;
        }
        state = step(state, event);
        taken.push(event);
      }
      if (state === previous.state) {
        return previous;
      }
      return { ...previous, state, keystream: [...previous.keystream, ...taken] };
    });
  }, []);

  return {
    state: run.state,
    metrics: measure(run.state, now),
    finished,
    handleInput,
    keystream: run.keystream,
  };
}
