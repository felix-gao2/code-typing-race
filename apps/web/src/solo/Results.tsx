import type { Language } from '@ctr/generator';
import type { RunMetrics } from '@ctr/typing-engine';
import { useEffect, useRef } from 'react';
import type { BestOutcome } from './bests.ts';
import type { Ghost } from './ghost.ts';
import { Leaderboard } from './Leaderboard.tsx';

interface ResultsProps {
  readonly metrics: RunMetrics;
  /** Absent only if the run finished before a best could be read or written. */
  readonly outcome: BestOutcome | undefined;
  readonly onRetry: () => void;
  readonly onNewSnippet: () => void;
  readonly onRaceSomeone: () => void;
  readonly onRaceFriend: () => void;
  readonly onRaceGhost: () => void;
  /** The run that was on screen during this one, absent the first time a
   * snippet is finished. */
  readonly ghost: Ghost | undefined;
  /** Whether the ghost above was actually racing, rather than merely stored. */
  readonly racedGhost: boolean;
  readonly language: Language;
  readonly lines: number;
  /** Changes once the run has been recorded, so the board reloads with it. */
  readonly recordedKey: string;
}

/**
 * Shown in place of the snippet once a run finishes. `SPEC.md` calls this the
 * strongest entry point into racing — someone holding a number is at peak
 * intent for "race this" — so the race buttons live here and not only in the
 * header.
 *
 * It takes focus and keeps tab and esc working, because the capture textarea
 * they belonged to is no longer on screen.
 */
export function Results({
  metrics,
  outcome,
  onRetry,
  onNewSnippet,
  onRaceSomeone,
  onRaceFriend,
  onRaceGhost,
  ghost,
  racedGhost,
  language,
  lines,
  recordedKey,
}: ResultsProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div
      ref={panel}
      className="results"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          event.preventDefault();
          onNewSnippet();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onRetry();
        }
      }}
    >
      <section className="stats stats-final">
        <Stat label="wpm" value={metrics.wpm.toFixed(0)} />
        <Stat label="acc" value={`${(metrics.accuracy * 100).toFixed(0)}%`} />
        <Stat label="time" value={`${(metrics.elapsedMs / 1000).toFixed(1)}s`} />
        <Stat label="errors" value={String(metrics.errors)} />
      </section>

      <p className="best">{bestLine(metrics, outcome)}</p>

      {racedGhost && ghost !== undefined && <p className="best">{ghostLine(metrics, ghost)}</p>}

      <Leaderboard language={language} lines={lines} refreshKey={recordedKey} />

      <div className="actions">
        <button type="button" onClick={onRetry}>
          retry · esc
        </button>
        <button type="button" onClick={onNewSnippet}>
          next snippet · tab
        </button>
        {/* The run that just finished is now this snippet's ghost, so there is
            always one to offer by the time this screen is on. */}
        <button type="button" onClick={onRaceGhost}>
          race your last run
        </button>
        <button type="button" onClick={onRaceSomeone}>
          race someone
        </button>
        <button type="button" onClick={onRaceFriend}>
          race a friend
        </button>
      </div>
    </div>
  );
}

function bestLine(metrics: RunMetrics, outcome: BestOutcome | undefined): string {
  if (outcome === undefined) {
    return '';
  }
  if (outcome.previous === undefined) {
    return 'first run at this length — this is your best';
  }
  if (outcome.improved) {
    const gain = metrics.wpm - outcome.previous.wpm;
    return `new best · +${gain.toFixed(0)} wpm on ${outcome.previous.wpm.toFixed(0)}`;
  }
  return `your best: ${outcome.best.wpm.toFixed(0)} wpm`;
}

/** Speed decides, the same as the personal best and the boards do. */
function ghostLine(metrics: RunMetrics, ghost: Ghost): string {
  const margin = Math.abs(metrics.wpm - ghost.wpm).toFixed(0);
  return metrics.wpm > ghost.wpm
    ? `beat your ghost by ${margin} wpm`
    : `lost to your ghost by ${margin} wpm`;
}

/** Shared with the live row on the solo page, so the two never drift apart. */
export function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <span className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </span>
  );
}
