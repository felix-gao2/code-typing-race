import { describe, expect, it } from 'vitest';
import { bestKey, compareToBest, readBest, saveBest, type Best, type BestStore } from './bests.ts';

const key = bestKey('java', 20);

function fakeStore(
  initial?: Record<string, string>,
): BestStore & { readonly items: Map<string, string> } {
  const items = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    items,
    getItem: (name) => items.get(name) ?? null,
    setItem: (name, value) => {
      items.set(name, value);
    },
  };
}

/** Storage that throws on every access, as a private-mode browser does. */
const hostileStore: BestStore = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
};

const run: Best = { wpm: 80, accuracy: 0.97, elapsedMs: 12_000 };

describe('bestKey', () => {
  it('separates languages and line counts, which are what make a run hard', () => {
    expect(bestKey('java', 20)).not.toBe(bestKey('python', 20));
    expect(bestKey('java', 20)).not.toBe(bestKey('java', 35));
  });
});

describe('compareToBest', () => {
  it('makes the first run the best and reports no previous', () => {
    expect(compareToBest(run, undefined)).toStrictEqual({ best: run, improved: true });
  });

  it('keeps the previous best when the new run is slower', () => {
    const slower = { wpm: 61, accuracy: 1, elapsedMs: 20_000 };

    expect(compareToBest(slower, run)).toStrictEqual({ best: run, previous: run, improved: false });
  });

  it('prefers the faster run even when it is less accurate', () => {
    const faster = { wpm: 91, accuracy: 0.8, elapsedMs: 10_500 };

    expect(compareToBest(faster, run)).toStrictEqual({
      best: faster,
      previous: run,
      improved: true,
    });
  });

  it('does not count an equal run as an improvement', () => {
    expect(compareToBest({ ...run }, run).improved).toBe(false);
  });
});

describe('saveBest', () => {
  it('stores the first run', () => {
    const store = fakeStore();
    saveBest(store, key, run);

    expect(readBest(store, key)).toStrictEqual(run);
  });

  it('leaves a faster stored run alone', () => {
    const store = fakeStore();
    saveBest(store, key, run);
    saveBest(store, key, { wpm: 61, accuracy: 1, elapsedMs: 20_000 });

    expect(readBest(store, key)).toStrictEqual(run);
  });

  it('is safe to repeat for the same run, which a re-render can do', () => {
    const store = fakeStore();
    saveBest(store, key, run);
    saveBest(store, key, run);

    expect(store.items.size).toBe(1);
    expect(readBest(store, key)).toStrictEqual(run);
  });

  it('does not throw when storage refuses to be written', () => {
    expect(() => saveBest(hostileStore, key, run)).not.toThrow();
  });
});

describe('readBest', () => {
  it('has no best before anything is recorded', () => {
    expect(readBest(fakeStore(), key)).toBeUndefined();
  });

  it('degrades to no best rather than throwing when storage is unreachable', () => {
    expect(readBest(hostileStore, key)).toBeUndefined();
  });

  it('discards a record that is not JSON', () => {
    expect(readBest(fakeStore({ [key]: 'not json {' }), key)).toBeUndefined();
  });

  it('discards a record written by a different stored version', () => {
    const stored = JSON.stringify({ version: 99, wpm: 120, accuracy: 1, elapsedMs: 1 });
    expect(readBest(fakeStore({ [key]: stored }), key)).toBeUndefined();
  });

  it('discards a record whose numbers are missing or unusable', () => {
    const missing = JSON.stringify({ version: 1, accuracy: 1, elapsedMs: 1 });
    const unusable = JSON.stringify({ version: 1, wpm: '80', accuracy: 1, elapsedMs: 1 });
    expect(readBest(fakeStore({ [key]: missing }), key)).toBeUndefined();
    expect(readBest(fakeStore({ [key]: unusable }), key)).toBeUndefined();
  });
});
