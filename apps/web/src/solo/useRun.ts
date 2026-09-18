import { generateSnippet, GENERATOR_VERSION, type Language } from '@ctr/generator';
import type { InputEvent, RunMetrics, RunState } from '@ctr/typing-engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTypingRun } from '../typing/useTypingRun.ts';
import { ghostKey, readGhost, rebase, saveGhost, type Ghost } from './ghost.ts';
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
  /** What the server recomputes the result from. The client's own numbers
   * are never the ones that count. */
  readonly keystream: readonly InputEvent[];
  /** Feed a `beforeinput`. Returns nothing; the caller prevents the default. */
  readonly handleInput: (intent: InputIntent) => void;
  /** A different snippet. */
  readonly newSnippet: () => void;
  /** The same snippet again, which is what makes two runs comparable. */
  readonly retry: () => void;
  /**
   * The run this snippet was last finished in, absent until it has been
   * finished once. Read at the start of the attempt, so finishing does not
   * replace the ghost the attempt is being measured against.
   */
  readonly ghost: Ghost | undefined;
  /** The same snippet again with the ghost on screen. */
  readonly raceGhost: () => void;
  /** Whether this attempt is the one the player asked to race the ghost. */
  readonly racingGhost: boolean;
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
  const [{ seed, attempt, racingGhost }, setIdentity] = useState(() => ({
    seed: randomSeed(),
    attempt: 0,
    racingGhost: false,
  }));

  const text = useMemo(() => generateSnippet({ seed, language, lines }), [seed, language, lines]);

  // A run is identified by everything that would change the text, plus the
  // attempt — retrying the same snippet has to start a new run even though
  // nothing about the text moved.
  const runKey = `${language}:${lines}:${seed}:${attempt}`;
  const run = useTypingRun(text, runKey);

  const key = ghostKey({ generatorVersion: GENERATOR_VERSION, language, lines, seed });

  // Read during render rather than in an effect, the same way the run itself
  // resets: reading storage changes nothing, and an effect would paint one
  // frame of the attempt against the wrong opponent. `runKey` carries
  // everything `key` does, so it changes whenever the snippet does.
  const [slot, setSlot] = useState(() => ({ runKey, ghost: readGhost(window.localStorage, key) }));
  if (slot.runKey !== runKey) {
    setSlot({ runKey, ghost: readGhost(window.localStorage, key) });
  }

  // Writing is the only part that touches the browser, so it is the only part
  // in an effect. Recorded once per attempt: the ghost is the last run, and
  // re-recording the same finished one would only rewrite it with itself.
  const recorded = useRef<string | undefined>(undefined);
  const { finished, keystream, metrics } = run;
  useEffect(() => {
    if (!finished || recorded.current === runKey || keystream.length === 0) {
      return;
    }
    recorded.current = runKey;
    saveGhost(window.localStorage, key, {
      wpm: metrics.wpm,
      accuracy: metrics.accuracy,
      events: rebase(keystream),
    });
  }, [finished, runKey, key, keystream, metrics]);

  const newSnippet = useCallback(
    () => setIdentity({ seed: randomSeed(), attempt: 0, racingGhost: false }),
    [],
  );
  const retry = useCallback(
    () =>
      setIdentity((previous) => ({
        ...previous,
        attempt: previous.attempt + 1,
        racingGhost: false,
      })),
    [],
  );
  const raceGhost = useCallback(
    () =>
      setIdentity((previous) => ({
        ...previous,
        attempt: previous.attempt + 1,
        racingGhost: true,
      })),
    [],
  );

  return {
    seed,
    runKey,
    state: run.state,
    metrics: run.metrics,
    finished: run.finished,
    keystream: run.keystream,
    handleInput: run.handleInput,
    newSnippet,
    retry,
    ghost: slot.ghost,
    raceGhost,
    racingGhost,
  };
}
