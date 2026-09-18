import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS,
  cleanName,
  loadPlayer,
  NAME_MAX,
  savePlayer,
  type PlayerStore,
} from './player.ts';

function fakeStore(initial?: Record<string, string>): PlayerStore {
  const items = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (name) => items.get(name) ?? null,
    setItem: (name, value) => {
      items.set(name, value);
    },
  };
}

const hostileStore: PlayerStore = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
};

/** Ids are handed in, so a test never depends on what the browser generates. */
function ids(...values: string[]): () => string {
  const queue = [...values];
  return () => queue.shift() ?? 'exhausted';
}

describe('cleanName', () => {
  it('keeps letters, digits and separators from any script', () => {
    expect(cleanName('felix_2 gao-1')).toBe('felix_2 gao-1');
    expect(cleanName('ゆうき')).toBe('ゆうき');
  });

  it('strips what would wreck a row of a leaderboard', () => {
    expect(cleanName('fe‮lix')).toBe('felix');
    expect(cleanName('a​b')).toBe('ab');
    expect(cleanName('nice 🙂 name')).toBe('nice name');
  });

  it('collapses runs of whitespace and trims the ends', () => {
    expect(cleanName('  felix   gao \n')).toBe('felix gao');
  });

  it('truncates to the limit without leaving a trailing space', () => {
    const long = cleanName('a'.repeat(NAME_MAX + 10));
    expect(long).toHaveLength(NAME_MAX);
    expect(cleanName(`${'a'.repeat(NAME_MAX - 1)} bcd`)).toBe('a'.repeat(NAME_MAX - 1));
  });

  it('falls back rather than producing an empty name', () => {
    expect(cleanName('')).toBe(ANONYMOUS);
    expect(cleanName('   ')).toBe(ANONYMOUS);
    expect(cleanName('🙂🙂')).toBe(ANONYMOUS);
  });
});

describe('loadPlayer', () => {
  it('mints a new player when there is nothing stored', () => {
    expect(loadPlayer(fakeStore(), ids('id-1'))).toStrictEqual({ id: 'id-1', name: ANONYMOUS });
  });

  it('does not write the new player, since nothing was done yet', () => {
    const store = fakeStore();
    loadPlayer(store, ids('id-1'));

    expect(loadPlayer(store, ids('id-2')).id).toBe('id-2');
  });

  it('returns the stored player across loads', () => {
    const store = fakeStore();
    savePlayer(store, { id: 'id-1', name: 'felix' });

    expect(loadPlayer(store, ids('id-2'))).toStrictEqual({ id: 'id-1', name: 'felix' });
  });

  it('cleans a stored name, so storage edited by hand cannot smuggle one in', () => {
    const stored = JSON.stringify({ version: 1, id: 'id-1', name: 'fe‮lix 🙂' });

    expect(loadPlayer(fakeStore({ 'ctr.player': stored }), ids('id-2')).name).toBe('felix');
  });

  it('starts over on a record from another version', () => {
    const stored = JSON.stringify({ version: 99, id: 'id-1', name: 'felix' });

    expect(loadPlayer(fakeStore({ 'ctr.player': stored }), ids('id-2')).id).toBe('id-2');
  });

  it('starts over on a record with no usable id', () => {
    const stored = JSON.stringify({ version: 1, id: '', name: 'felix' });

    expect(loadPlayer(fakeStore({ 'ctr.player': stored }), ids('id-2')).id).toBe('id-2');
  });

  it('starts over on storage that is not JSON', () => {
    expect(loadPlayer(fakeStore({ 'ctr.player': '{oops' }), ids('id-2')).id).toBe('id-2');
  });

  it('becomes a new player rather than throwing when storage is unreachable', () => {
    expect(loadPlayer(hostileStore, ids('id-1'))).toStrictEqual({ id: 'id-1', name: ANONYMOUS });
  });
});

describe('savePlayer', () => {
  it('returns the cleaned name, which is what the caller should display', () => {
    expect(savePlayer(fakeStore(), { id: 'id-1', name: '  FELIX🙂  ' })).toStrictEqual({
      id: 'id-1',
      name: 'FELIX',
    });
  });

  it('keeps the id it was given', () => {
    const store = fakeStore();
    savePlayer(store, { id: 'id-1', name: 'felix' });
    savePlayer(store, { id: 'id-1', name: 'gao' });

    expect(loadPlayer(store, ids('id-2'))).toStrictEqual({ id: 'id-1', name: 'gao' });
  });

  it('still reports the cleaned name when storage refuses to be written', () => {
    expect(savePlayer(hostileStore, { id: 'id-1', name: 'felix' }).name).toBe('felix');
  });
});
