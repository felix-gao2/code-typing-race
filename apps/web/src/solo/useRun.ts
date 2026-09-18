import { generateSnippet, type Language } from '@ctr/generator';
import type { RunMetrics, RunState } from '@ctr/typing-engine';
import { useCallback, useMemo, useState } from 'react';
import { useTypingRun } from '../typing/useTypingRun.ts';
import type { InputIntent } from './input.ts';

export interface Run {
  readonly seed: number;
  /**
   * Everything that identifies this attempt: the text plus how many times it
   * has been retried. Changes on a retry even though the text does not, which
   * is what lets a caller tell one attempt from the next.
   */
  readonly runKey: string;
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

/**
 * A solo run. This hook owns which snippet is being typed; the typing itself
 * is the same code a race uses.
 */
export function useRun(language: Language, lines: number): Run {
  const [{ seed, attempt }, setIdentity] = useState(() => ({ seed: randomSeed(), attempt: 0 }));

  const text = useMemo(() => generateSnippet({ seed, language, lines }), [seed, language, lines]);

  // A run is identified by everything that would change the text, plus the
  // attempt — retrying the same snippet has to start a new run even though
  // nothing about the text moved.
  const runKey = `${language}:${lines}:${seed}:${attempt}`;
  const run = useTypingRun(text, runKey);

  const newSnippet = useCallback(() => setIdentity({ seed: randomSeed(), attempt: 0 }), []);
  const retry = useCallback(
    () => setIdentity((previous) => ({ ...previous, attempt: previous.attempt + 1 })),
    [],
  );

  return {
    seed,
    runKey,
    state: run.state,
    metrics: run.metrics,
    finished: run.finished,
    handleInput: run.handleInput,
    newSnippet,
    retry,
  };
}
