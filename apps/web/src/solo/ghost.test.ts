import type { InputEvent } from '@ctr/typing-engine';
import { describe, expect, it } from 'vitest';
import {
  ghostKey,
  ghostProgress,
  readGhost,
  rebase,
  saveGhost,
  type Ghost,
  type GhostStore,
} from './ghost.ts';

const identity = { generatorVersion: 3, language: 'java', lines: 20, seed: 7 } as const;
const key = ghostKey(identity);

function fakeStore(
  initial?: Record<string, string>,
): GhostStore & { readonly items: Map<string, string> } {
  const items = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    items,
    getItem: (name) => items.get(name) ?? null,
    setItem: (name, value) => {
      items.set(name, value);
    },
    removeItem: (name) => {
      items.delete(name);
    },
  };
}

/** Storage that throws on every access, as a private-mode browser does. */
const hostileStore: GhostStore = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  removeItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
};

function char(c: string, at: number): InputEvent {
  return { kind: 'char', char: c, at };
}

function backspace(at: number): InputEvent {
  return { kind: 'backspace', at };
}

const ghost: Ghost = {
  wpm: 80,
  accuracy: 0.97,
  events: [char('a', 0), char('b', 100), char('c', 200)],
};

describe('ghostKey', () => {
  it('separates every part of the identity', () => {
    expect(ghostKey({ ...identity, generatorVersion: 4 })).not.toBe(key);
    expect(ghostKey({ ...identity, language: 'python' })).not.toBe(key);
    expect(ghostKey({ ...identity, lines: 35 })).not.toBe(key);
    expect(ghostKey({ ...identity, seed: 8 })).not.toBe(key);
  });
});

describe('rebase', () => {
  it('counts from the first keystroke rather than the page load', () => {
    expect(rebase([char('a', 5_000), backspace(5_250), char('b', 5_400)])).toStrictEqual([
      char('a', 0),
      backspace(250),
      char('b', 400),
    ]);
  });

  it('has nothing to rebase onto when nothing was typed', () => {
    expect(rebase([])).toStrictEqual([]);
  });
});

describe('ghostProgress', () => {
  it('has not started before the first keystroke', () => {
    expect(ghostProgress(ghost.events, -1, 10)).toBe(0);
  });

  it('counts the keystroke landing exactly on the elapsed time', () => {
    expect(ghostProgress(ghost.events, 0, 10)).toBeCloseTo(0.1);
    expect(ghostProgress(ghost.events, 100, 10)).toBeCloseTo(0.2);
  });

  it('holds position between keystrokes rather than interpolating', () => {
    expect(ghostProgress(ghost.events, 199, 10)).toBeCloseTo(0.2);
  });

  it('walks backwards on a backspace', () => {
    const events = [char('a', 0), char('b', 10), backspace(20)];
    expect(ghostProgress(events, 20, 10)).toBeCloseTo(0.1);
  });

  it('never walks past the start', () => {
    expect(ghostProgress([backspace(0), backspace(10)], 100, 10)).toBe(0);
  });

  it('pins a finished ghost at the end however long the live run takes', () => {
    expect(ghostProgress(ghost.events, 200, 3)).toBe(1);
    expect(ghostProgress(ghost.events, 9_999_999, 3)).toBe(1);
  });

  it('is nowhere when there is nothing to type', () => {
    expect(ghostProgress(ghost.events, 500, 0)).toBe(0);
  });

  it('is at the start when nothing was typed', () => {
    expect(ghostProgress([], 500, 10)).toBe(0);
  });
});

describe('saveGhost and readGhost', () => {
  it('round-trips a run', () => {
    const store = fakeStore();
    saveGhost(store, key, ghost);
    expect(readGhost(store, key)).toStrictEqual(ghost);
  });

  it('keeps one ghost per snippet, replacing the last run', () => {
    const store = fakeStore();
    saveGhost(store, key, ghost);
    const faster: Ghost = { ...ghost, wpm: 120 };
    saveGhost(store, key, faster);
    expect(readGhost(store, key)).toStrictEqual(faster);
  });

  it('separates snippets', () => {
    const store = fakeStore();
    saveGhost(store, key, ghost);
    expect(readGhost(store, ghostKey({ ...identity, seed: 8 }))).toBeUndefined();
  });

  it('has no ghost for a snippet never raced', () => {
    expect(readGhost(fakeStore(), key)).toBeUndefined();
  });

  it('survives a store that denies every access', () => {
    expect(readGhost(hostileStore, key)).toBeUndefined();
    expect(() => saveGhost(hostileStore, key, ghost)).not.toThrow();
  });

  it('discards a record from another version', () => {
    const store = fakeStore({ [key]: JSON.stringify({ version: 99, ...ghost }) });
    expect(readGhost(store, key)).toBeUndefined();
  });

  it('discards unparseable storage', () => {
    expect(readGhost(fakeStore({ [key]: 'not json' }), key)).toBeUndefined();
  });

  it('discards a ghost with a malformed event, since every later position is wrong', () => {
    const store = fakeStore({
      [key]: JSON.stringify({
        version: 1,
        wpm: 80,
        accuracy: 0.97,
        events: [
          { kind: 'char', char: 'a', at: 0 },
          { kind: 'char', at: 100 },
        ],
      }),
    });
    expect(readGhost(store, key)).toBeUndefined();
  });

  it('evicts the oldest once the cap is reached', () => {
    const store = fakeStore();
    const keys = Array.from({ length: 21 }, (_, seed) => ghostKey({ ...identity, seed }));
    for (const each of keys) {
      saveGhost(store, each, ghost);
    }
    expect(readGhost(store, keys[0] as string)).toBeUndefined();
    expect(readGhost(store, keys[1] as string)).toBeDefined();
    expect(readGhost(store, keys[20] as string)).toBeDefined();
  });

  it('spares a ghost re-raced since, because saving it is what makes it recent', () => {
    const store = fakeStore();
    const keys = Array.from({ length: 20 }, (_, seed) => ghostKey({ ...identity, seed }));
    for (const each of keys) {
      saveGhost(store, each, ghost);
    }
    saveGhost(store, keys[0] as string, ghost);
    saveGhost(store, ghostKey({ ...identity, seed: 999 }), ghost);

    expect(readGhost(store, keys[0] as string)).toBeDefined();
    expect(readGhost(store, keys[1] as string)).toBeUndefined();
  });
});
