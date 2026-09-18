/**
 * Who is typing. `SPEC.md` settles this: no accounts at launch, identity is an
 * anonymous UUID in localStorage, and the display name is a label on it.
 * Clearing storage means becoming a new player, which is accepted.
 *
 * The name has limits because a name on a public board is a moderation
 * surface whether or not one is wanted — so the limits exist from the first
 * commit rather than after the first board.
 *
 * The store and the id source both arrive as arguments, which is what keeps
 * the rules testable and the browser out of them.
 */

const STORED_KEY = 'ctr.player';

/** Bumped if the stored shape changes; an older record is replaced, not read. */
const STORED_VERSION = 1;

export const NAME_MAX = 20;

/** What is left when a name is nothing but spaces or forbidden characters. */
export const ANONYMOUS = 'anon';

/** The part of `Storage` this needs. `window.localStorage` satisfies it. */
export interface PlayerStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface Player {
  readonly id: string;
  readonly name: string;
}

/**
 * Letters, digits, and a few separators. Deliberately narrow: everything
 * outside it — combining marks, right-to-left overrides, emoji, zero-width
 * joiners — is a way to make one row of a board wreck the rest of it.
 */
const ALLOWED = /[^\p{L}\p{N} _-]/gu;

/**
 * Trims, strips what is not allowed, collapses runs of spaces, and truncates.
 * Never fails: a name that survives none of that becomes `anon`, because
 * refusing to save a player over their name would cost them their identity.
 */
export function cleanName(raw: string): string {
  const cleaned = raw.replace(ALLOWED, '').replace(/\s+/gu, ' ').trim().slice(0, NAME_MAX).trim();
  return cleaned === '' ? ANONYMOUS : cleaned;
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
