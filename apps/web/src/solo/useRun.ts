import { generateSnippet, type Language } from '@ctr/generator';
import {
  DEFAULT_MODE,
  isFinished,
  measure,
  start,
  step,
  type RunMetrics,
  type RunState,
} from '@ctr/typing-engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toEvents, type InputIntent } from './input.ts';

/** How often the live WPM refreshes while typing. */
const TICK_MS = 100;

export interface Run {
  readonly seed: number;
  readonly state: RunState;
  readonly metrics: RunMetrics;
  readonly finished: boolean;
  /** Feed a `beforeinput`. Returns nothing; the caller prevents the default. */
  readonly handleInput: (intent: InputIntent) => void;
  /** A different snippet. */
  readonly newSnippet: () => void;
  /** The same snippet again, which is what makes two runs comparable. */
  readonly retry: () => void;
}

function randomSeed(): number {
  // Outside `packages/**`, so entropy is allowed here — and this is the only
  // place in the app that draws any. The seed is what a run is identified by.
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
}

export function useRun(language: Language, lines: number): Run {
  const [{ seed, attempt }, setIdentity] = useState(() => ({ seed: randomSeed(), attempt: 0 }));

  const text = useMemo(() => generateSnippet({ seed, language, lines }), [seed, language, lines]);

  // A run is identified by everything that would change the text, plus the
  // attempt — retrying the same snippet has to start a new run even though
  // nothing about the text moved.
  const key = `${language}:${lines}:${seed}:${attempt}`;
  const [run, setRun] = useState(() => ({ key, state: start(text, DEFAULT_MODE) }));
  if (run.key !== key) {
    // Resetting during render rather than in an effect, so no frame is ever
    // painted with the previous run's characters under the new snippet.
    setRun({ key, state: start(text, DEFAULT_MODE) });
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
      for (const event of events) {
        // A single insertion can carry more characters than the run has left.
        if (isFinished(state)) {
          break;
        }
        state = step(state, event);
      }
      return state === previous.state ? previous : { ...previous, state };
    });
  }, []);

  const newSnippet = useCallback(() => setIdentity({ seed: randomSeed(), attempt: 0 }), []);
  const retry = useCallback(
    () => setIdentity((previous) => ({ ...previous, attempt: previous.attempt + 1 })),
    [],
  );

  return {
    seed,
    state: run.state,
    metrics: measure(run.state, now),
    finished,
    handleInput,
    newSnippet,
    retry,
  };
}
