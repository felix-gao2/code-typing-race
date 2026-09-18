import type { Language } from '@ctr/generator';

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

/** The link to paste. Room codes are meant to travel through chat messages. */
export function roomLink(id: string): string {
  return `${window.location.origin}/r/${id}`;
}
