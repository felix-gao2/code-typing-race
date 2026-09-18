import { isLinePreset, LANGUAGES, LINE_PRESETS, type Language } from '@ctr/generator';
import { useState } from 'react';
import { openRoom, roomLink } from './race/api.ts';
import { RacePage } from './race/RacePage.tsx';
import { TypingSurface } from './solo/TypingSurface.tsx';
import { useRun } from './solo/useRun.ts';

/**
 * Routing is one pathname check rather than a router dependency: there are two
 * pages, and `/r/<code>` is the only one that carries a parameter.
 */
function roomFromPath(): string | undefined {
  const match = /^\/r\/([A-Za-z0-9]+)$/.exec(window.location.pathname);
  return match?.[1]?.toUpperCase();
}

export function App() {
  const room = roomFromPath();
  return room === undefined ? <SoloPage /> : <RacePage roomId={room} />;
}

/**
 * The deliberately ugly solo page: a snippet, a text box and some numbers.
 * The design pass is its own step and will replace all of the presentation
 * here — the point of this version is to be playable, so the feel questions
 * can be answered by typing rather than by argument.
 *
 * The language and length pickers are scaffolding, and exist so all three
 * printers can be felt. Difficulty is not a setting: every snippet is
 * generated at the same density, and length is the only thing chosen.
 */
function SoloPage() {
  const [language, setLanguage] = useState<Language>('java');
  const [lines, setLines] = useState<number>(20);
  const run = useRun(language, lines);
  const { metrics } = run;
  const [invite, setInvite] = useState<string | undefined>(undefined);
  const [raceError, setRaceError] = useState<string | undefined>(undefined);

  const startRace = (): void => {
    setRaceError(undefined);
    openRoom(language, lines)
      .then((opened) => setInvite(roomLink(opened.id)))
      // Surfacing the reason beats a dead button with no explanation.
      .catch((error: unknown) =>
        setRaceError(error instanceof Error ? error.message : 'could not open a room'),
      );
  };

  return (
    <main className="page">
      <header className="bar">
        <select
          value={language}
          onChange={(event) => setLanguage(event.target.value as Language)}
          aria-label="Language"
        >
          {LANGUAGES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={isLinePreset(lines) ? lines : 'custom'}
          onChange={(event) => {
            if (event.target.value !== 'custom') {
              setLines(Number(event.target.value));
            }
          }}
          aria-label="Length"
        >
          {LINE_PRESETS.map((count) => (
            <option key={count} value={count}>
              {count} lines
            </option>
          ))}
          <option value="custom">custom</option>
        </select>
        <input
          type="number"
          min={1}
          value={lines}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isInteger(next) && next >= 1) {
              setLines(next);
            }
          }}
          aria-label="Lines"
        />
        {!isLinePreset(lines) && <span className="hint">custom · unranked</span>}
        <span className="seed">seed {run.seed}</span>
        <span className="hint">tab · new snippet &nbsp; esc · retry this one</span>
        <button type="button" onClick={startRace}>
          race a friend
        </button>
      </header>

      {invite !== undefined && (
        <p className="hint">
          send this link, then open it yourself: <a href={invite}>{invite}</a>
        </p>
      )}
      {raceError !== undefined && <p className="hint">{raceError}</p>}

      <TypingSurface
        state={run.state}
        onIntent={run.handleInput}
        onNewSnippet={run.newSnippet}
        onRetry={run.retry}
      />

      <section className={`stats${run.finished ? ' stats-final' : ''}`}>
        <Stat label="wpm" value={metrics.wpm.toFixed(0)} />
        <Stat label="acc" value={`${(metrics.accuracy * 100).toFixed(0)}%`} />
        <Stat label="time" value={`${(metrics.elapsedMs / 1000).toFixed(1)}s`} />
        <Stat label="errors" value={String(metrics.errors)} />
        <Stat label="done" value={`${(metrics.progress * 100).toFixed(0)}%`} />
      </section>
    </main>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <span className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </span>
  );
}
