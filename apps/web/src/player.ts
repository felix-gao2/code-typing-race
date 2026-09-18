/**
 * Who is typing. `SPEC.md` settles this: no accounts at launch, identity is an
 * anonymous UUID in localStorage, and the display name is a label on it.
 * Clearing storage means becoming a new player, which is accepted.
 *
 * Only the storage lives here. What a name is allowed to be is shared with the
 * server, which cannot trust the one a client sends.
 *
 * The store and the id source both arrive as arguments, which is what keeps
 * this testable and the browser out of it.
 */

import { ANONYMOUS, cleanName, type Player } from '@ctr/shared-types';

const STORED_KEY = 'ctr.player';

/** Bumped if the stored shape changes; an older record is replaced, not read. */
const STORED_VERSION = 1;

/** The part of `Storage` this needs. `window.localStorage` satisfies it. */
export interface PlayerStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/**
 * The stored player, or a new one. A new player is returned but not written:
 * storage is only touched when there is something a player did to record.
 *
 * @param newId supplies the identity for a first-time player, normally
 * `crypto.randomUUID`
 */
export function loadPlayer(store: PlayerStore, newId: () => string): Player {
  let raw: string | null;
  try {
    raw = store.getItem(STORED_KEY);
  } catch {
    // Storage throws outright in private mode and wherever site data is
    // blocked. A player who cannot be stored is a new player every visit,
    // which is the same thing clearing storage does and is already accepted.
    return { id: newId(), name: ANONYMOUS };
  }

  if (raw !== null) {
    try {
      const stored = parse(JSON.parse(raw));
      if (stored !== undefined) {
        return stored;
      }
    } catch {
      // Unparseable storage is another version or a half-finished write.
      // Starting over is the whole recovery; there is nothing to salvage.
    }
  }
  return { id: newId(), name: ANONYMOUS };
}

export function savePlayer(store: PlayerStore, player: Player): Player {
  const cleaned: Player = { id: player.id, name: cleanName(player.name) };
  try {
    store.setItem(STORED_KEY, JSON.stringify({ version: STORED_VERSION, ...cleaned }));
  } catch {
    // Same as above: the name holds for this session and is lost on reload.
    // Nothing else in the app depends on it having been written.
  }
  return cleaned;
}

function parse(value: unknown): Player | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record['version'] !== STORED_VERSION) {
    return undefined;
  }
  const { id, name } = record;
  if (typeof id !== 'string' || id === '' || typeof name !== 'string') {
    return undefined;
  }
  return { id, name: cleanName(name) };
}
