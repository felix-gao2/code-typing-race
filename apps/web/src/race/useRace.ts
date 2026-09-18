import type { InputEvent, RunMetrics } from '@ctr/typing-engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { loadPlayer } from '../player.ts';
import { SERVER_URL } from './api.ts';

/**
 * A racer's view of a race. Mirrors the server's `RaceView`, which is
 * deliberately less than the server knows: no seed, no keystreams.
 */
export interface RaceView {
  readonly id: string;
  readonly phase: 'waiting' | 'countdown' | 'racing' | 'finished';
  readonly kind: 'public' | 'private';
  readonly text: string;
  readonly startedAt: number | undefined;
  readonly racers: readonly {
    readonly id: string;
    readonly progress: number;
    readonly connected: boolean;
    readonly finishedAt: number | undefined;
  }[];
}

/** A result as the server computed it, which is the only one that counts. */
export interface RunResult {
  readonly racerId: string;
  readonly metrics: RunMetrics;
  readonly seed: number;
  readonly language: string;
  readonly lines: number;
}

export interface Race {
  readonly view: RaceView | undefined;
  /** Who we are in this race, as the server named us. */
  readonly racerId: string | undefined;
  readonly results: readonly RunResult[];
  readonly error: string | undefined;
  readonly connected: boolean;
  /** Advisory: moves other racers' bars. Never used to compute a result. */
  readonly reportProgress: (progress: number) => void;
  /** Hands the whole keystream over for the server to recompute. */
  readonly submit: (keystream: readonly InputEvent[]) => void;
}

interface JoinAck {
  readonly ok: boolean;
  readonly error?: string;
  readonly racerId?: string;
  readonly race?: RaceView;
}

export function useRace(roomId: string): Race {
  const [view, setView] = useState<RaceView | undefined>(undefined);
  const [racerId, setRacerId] = useState<string | undefined>(undefined);
  const [results, setResults] = useState<readonly RunResult[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [connected, setConnected] = useState(false);
  const socket = useRef<Socket | undefined>(undefined);

  useEffect(() => {
    const client = io(SERVER_URL, { transports: ['websocket'] });
    socket.current = client;

    client.on('connect', () => {
      setConnected(true);
      // Joining on every connect rather than once: a reconnect has to rejoin,
      // which is the case the whole disconnect design exists for.
      client.emit('join', roomId, (ack: JoinAck) => {
        if (!ack.ok) {
          setError(ack.error ?? 'could not join');
          return;
        }
        setError(undefined);
        setRacerId(ack.racerId);
        if (ack.race !== undefined) {
          setView(ack.race);
        }
      });
    });

    client.on('disconnect', () => setConnected(false));
    client.on('connect_error', () => setError('cannot reach the race server'));
    client.on('race', (next: RaceView) => setView(next));
    client.on('result', (result: RunResult) => {
      setResults((previous) =>
        previous.some((existing) => existing.racerId === result.racerId)
          ? previous
          : [...previous, result],
      );
    });

    return () => {
      client.removeAllListeners();
      client.disconnect();
      socket.current = undefined;
    };
  }, [roomId]);

  const reportProgress = useCallback((progress: number) => {
    socket.current?.emit('progress', progress);
  }, []);

  const submit = useCallback((keystream: readonly InputEvent[]) => {
    // Read at submission rather than held: a name changed between joining and
    // finishing should be the one the result is credited to.
    const player = loadPlayer(window.localStorage, () => crypto.randomUUID());
    socket.current?.emit(
      'submit',
      { events: keystream, player },
      (ack: { ok: boolean; error?: string }) => {
        if (!ack.ok) {
          // The server rejected the run. Saying so beats showing a result that
          // was never accepted.
          setError(ack.error ?? 'the server rejected this run');
        }
      },
    );
  }, []);

  return { view, racerId, results, error, connected, reportProgress, submit };
}
