import { isLinePreset, type Language } from '@ctr/generator';
import { useEffect, useState } from 'react';
import { fetchLeaderboard, type BoardEntry } from '../race/api.ts';

interface LeaderboardProps {
  readonly language: Language;
  readonly lines: number;
  /** Changes when a run is submitted, so the board reloads with it on it. */
  readonly refreshKey: string;
}

type Load =
  | { readonly status: 'ready'; readonly stored: boolean; readonly entries: readonly BoardEntry[] }
  | { readonly status: 'failed'; readonly message: string };

/** What the board was loaded for, so a stale answer is never shown as fresh. */
interface Loaded {
  readonly key: string;
  readonly load: Load;
}

/**
 * The solo board for the language and length just typed. Shown on the results
 * screen rather than on a page of its own: it is the same moment `SPEC.md`
 * puts the race buttons at, and a number is worth most next to the numbers it
 * is being compared with.
 *
 * Daily rather than all-time, because a day-old board still has a place on it
 * for someone who just started.
 */
export function Leaderboard({ language, lines, refreshKey }: LeaderboardProps) {
  // What is on screen is whatever was loaded for this exact request. Anything
  // else is still loading, which is derived rather than stored — nothing has
  // to be set to enter that state, and a stale board can never be shown under
  // a new one's heading.
  const key = `${language}:${lines}:${refreshKey}`;
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const load = loaded?.key === key ? loaded.load : undefined;

  useEffect(() => {
    if (!isLinePreset(lines)) {
      return undefined;
    }
    // A run submitted a moment ago may still be landing; this runs again when
    // it lands. It is a second render of the board, not a poll.
    let live = true;
    fetchLeaderboard('solo', language, lines, 'daily')
      .then((board) => {
        if (live) {
          setLoaded({
            key,
            load: { status: 'ready', stored: board.stored, entries: board.entries },
          });
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setLoaded({
            key,
            load: {
              status: 'failed',
              message: error instanceof Error ? error.message : 'could not read the board',
            },
          });
        }
      });
    return () => {
      live = false;
    };
  }, [key, language, lines]);

  if (!isLinePreset(lines)) {
    return <p className="board-note">a custom length has no board — try 10, 20 or 35 lines</p>;
  }
  if (load === undefined) {
    return <p className="board-note">reading today&apos;s board…</p>;
  }
  if (load.status === 'failed') {
    return <p className="board-note">no board: {load.message}</p>;
  }
  if (!load.stored) {
    return <p className="board-note">the server is not storing runs, so there is no board yet</p>;
  }
  if (load.entries.length === 0) {
    return (
      <p className="board-note">nobody has qualified today — 90% accuracy and you are first</p>
    );
  }

  return (
    <ol className="board">
      {load.entries.map((entry, index) => (
        <li key={`${entry.playerName}-${entry.finishedAt}`} className="board-row">
          <span className="board-rank">{index + 1}</span>
          <span className="board-name">{entry.playerName}</span>
          <span className="board-wpm">{entry.wpm.toFixed(0)} wpm</span>
          <span className="board-acc">{(entry.accuracy * 100).toFixed(0)}%</span>
        </li>
      ))}
    </ol>
  );
}
