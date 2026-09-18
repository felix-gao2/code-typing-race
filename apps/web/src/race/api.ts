import type { Language } from '@ctr/generator';
import type { Player } from '@ctr/shared-types';
import type { InputEvent } from '@ctr/typing-engine';

/**
 * Where the race server lives. Set `VITE_SERVER_URL` to point a deployed web
 * app at a deployed server; the default is the local one.
 */
export const SERVER_URL: string =
  (import.meta.env['VITE_SERVER_URL'] as string | undefined) ?? 'http://localhost:3001';

export interface OpenedRoom {
  readonly id: string;
  readonly language: Language;
  readonly lines: number;
}

/**
 * Opens a private room. The snippet is generated server-side and never sent
 * from here, so nobody picks the text they race on.
 */
export async function openRoom(language: Language, lines: number): Promise<OpenedRoom> {
  const response = await fetch(`${SERVER_URL}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language, lines }),
  });

  if (!response.ok) {
    // The server says what was wrong with the request; passing it through beats
    // inventing a friendlier message that hides which field was rejected.
    const body: unknown = await response.json().catch(() => ({}));
    const error = typeof body === 'object' && body !== null && 'error' in body ? body.error : null;
    throw new Error(
      typeof error === 'string' ? error : `could not open a room (${response.status})`,
    );
  }

  return (await response.json()) as OpenedRoom;
}

/**
 * Asks the server for a public race to join. Uses a short-lived socket rather
 * than an HTTP route because matchmaking is a socket concern and the client is
 * about to open one anyway.
 */
export async function quickmatch(language: Language, lines: number): Promise<string> {
  const { io } = await import('socket.io-client');
  const socket = io(SERVER_URL, { transports: ['websocket'] });

  try {
    return await new Promise<string>((resolve, reject) => {
      const giveUp = setTimeout(() => reject(new Error('the race server did not answer')), 5000);

      socket.on('connect_error', () => {
        clearTimeout(giveUp);
        reject(new Error('cannot reach the race server'));
      });

      socket.on('connect', () => {
        socket.emit(
          'quickmatch',
          { language, lines },
          (ack: { ok: boolean; id?: string; error?: string }) => {
            clearTimeout(giveUp);
            if (ack.ok && ack.id !== undefined) {
              resolve(ack.id);
            } else {
              reject(new Error(ack.error ?? 'could not find a race'));
            }
          },
        );
      });
    });
  } finally {
    // The race page opens its own socket; this one only asked a question.
    socket.disconnect();
  }
}

/**
 * Hands a finished solo run to the server, which regenerates the snippet from
 * the identity here and recomputes the result from the keystream. Nothing in
 * this body is a score — there is no field for one, which is the point.
 *
 * Lives beside the race calls because they share `SERVER_URL`, not because a
 * solo run is a race.
 */
export async function submitRun(run: {
  readonly language: Language;
  readonly lines: number;
  readonly seed: number;
  readonly player: Player;
  readonly events: readonly InputEvent[];
}): Promise<void> {
  const response = await fetch(`${SERVER_URL}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(run),
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    const error = typeof body === 'object' && body !== null && 'error' in body ? body.error : null;
    throw new Error(
      typeof error === 'string' ? error : `the server rejected this run (${response.status})`,
    );
  }
}

/** The link to paste. Room codes are meant to travel through chat messages. */
export function roomLink(id: string): string {
  return `${window.location.origin}/r/${id}`;
}
