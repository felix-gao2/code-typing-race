import { useEffect, useRef } from 'react';
import { TypingSurface } from '../solo/TypingSurface.tsx';
import { useTypingRun } from '../typing/useTypingRun.ts';
import { useRace, type Race, type RaceView } from './useRace.ts';

/**
 * The race page, deliberately as plain as the solo one. The design pass owns
 * all of the presentation here; what this proves is the round trip.
 *
 * Split in two on purpose: the run cannot be mounted until the server has sent
 * the snippet, because an empty target is not a run the engine will start. A
 * hook cannot be conditional, so the waiting happens in a component that has
 * no run in it.
 */
export function RacePage({ roomId }: { readonly roomId: string }) {
  const race = useRace(roomId);

  if (race.error !== undefined) {
    return (
      <main className="page">
        <p className="hint">{race.error}</p>
        <p className="hint">
          <a href="/">back to solo</a>
        </p>
      </main>
    );
  }

  if (race.view === undefined) {
    return (
      <main className="page">
        <p className="hint">{race.connected ? 'joining…' : 'connecting…'}</p>
      </main>
    );
  }

  return <RaceRun race={race} view={race.view} roomId={roomId} />;
}

function RaceRun({
  race,
  view,
  roomId,
}: {
  readonly race: Race;
  readonly view: RaceView;
  readonly roomId: string;
}) {
  // Typing is only live while the race is. Before that the target is shown but
  // inert, which is what makes a synced countdown mean anything.
  const racing = view.phase === 'racing';
  const run = useTypingRun(view.text, `${roomId}:${view.startedAt ?? 'pending'}`);

  // Progress is advisory, so it is sent on change rather than on every key.
  const sentProgress = useRef(-1);
  const { reportProgress, submit } = race;
  const progress = run.metrics.progress;
  useEffect(() => {
    if (!racing) {
      return;
    }
    const rounded = Math.round(progress * 100) / 100;
    if (rounded !== sentProgress.current) {
      sentProgress.current = rounded;
      reportProgress(rounded);
    }
  }, [racing, progress, reportProgress]);

  // The keystream goes over exactly once, the moment the run completes.
  const submitted = useRef(false);
  const { finished, keystream } = run;
  useEffect(() => {
    if (finished && !submitted.current) {
      submitted.current = true;
      submit(keystream);
    }
  }, [finished, keystream, submit]);

  return (
    <main className="page">
      <header className="bar">
        <span className="seed">room {view.id}</span>
        <span className="hint">{phaseLabel(view.phase, view.racers.length)}</span>
        {!race.connected && <span className="hint">reconnecting…</span>}
      </header>

      <section className="racers">
        {view.racers.map((racer) => (
          <div key={racer.id} className="racer">
            <span className="stat-label">
              {racer.id === race.racerId ? 'you' : racer.id.slice(0, 4)}
              {!racer.connected && ' (dropped)'}
            </span>
            <progress value={racer.progress} max={1} />
          </div>
        ))}
      </section>

      <TypingSurface
        state={run.state}
        onIntent={racing ? run.handleInput : () => undefined}
        onNewSnippet={() => undefined}
        onRetry={() => undefined}
      />

      <section className={`stats${run.finished ? ' stats-final' : ''}`}>
        <span className="stat">
          <span className="stat-value">{run.metrics.wpm.toFixed(0)}</span>
          <span className="stat-label">wpm</span>
        </span>
        <span className="stat">
          <span className="stat-value">{(run.metrics.accuracy * 100).toFixed(0)}%</span>
          <span className="stat-label">acc</span>
        </span>
      </section>

      {race.results.length > 0 && (
        <section className="results">
          <p className="hint">verified by the server</p>
          {race.results.map((result) => (
            <div key={result.racerId} className="racer">
              <span className="stat-label">
                {result.racerId === race.racerId ? 'you' : result.racerId.slice(0, 4)}
              </span>
              <span className="stat-value">
                {result.metrics.wpm.toFixed(0)} wpm · {(result.metrics.accuracy * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

function phaseLabel(phase: string, racers: number): string {
  switch (phase) {
    case 'waiting':
      return `waiting for racers · ${racers} here`;
    case 'countdown':
      return 'starting…';
    case 'racing':
      return 'go';
    default:
      return 'race over';
  }
}
