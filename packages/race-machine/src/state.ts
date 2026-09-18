/**
 * The shape of a race. Nothing here knows about sockets, timers or the typing
 * engine — a racer's progress arrives as a number, so a race can be tested
 * without constructing a single keystroke.
 */

/**
 * Which kind of race this is, stored from the moment the race exists. A
 * private-room result never reaches a leaderboard, and deciding that after the
 * fact means guessing at rows that no longer say where they came from.
 */
export type RaceKind = 'public' | 'private';

/**
 * `waiting` holds until there are enough racers, `countdown` is the synced
 * start every racer sees, `racing` is the run itself, `finished` is terminal.
 */
export type Phase = 'waiting' | 'countdown' | 'racing' | 'finished';

export interface Racer {
  readonly id: string;
  /** 0 to 1, as reported by whatever is running the typing engine. */
  readonly progress: number;
  /** When they crossed the end, if they did. */
  readonly finishedAt?: number;
  /**
   * Connected racers are the ones the race waits for. A disconnected racer
   * keeps their place and their progress — dropping them would end a race the
   * moment someone's wifi blinked.
   */
  readonly connected: boolean;
}

export interface RaceConfig {
  /** Racers needed before the countdown starts. */
  readonly minRacers: number;
  /** Racers the race will hold. Joins past this are refused. */
  readonly maxRacers: number;
  /** How long the synced countdown runs once `minRacers` is met. */
  readonly countdownMs: number;
  /**
   * How long a race may run before it is called. This is what stops a racer
   * who disconnected and never came back from hanging the race forever.
   */
  readonly raceTimeoutMs: number;
  /**
   * How long `waiting` may last before starting anyway with whoever is
   * present. `undefined` means wait indefinitely.
   *
   * Whether a public race with one player should start alone is undecided, so
   * it is a value rather than a rule — set it to start early, leave it off to
   * keep waiting.
   */
  readonly waitTimeoutMs?: number;
}

export interface RaceState {
  readonly kind: RaceKind;
  readonly phase: Phase;
  readonly config: RaceConfig;
  /** The snippet, as text. Races send text rather than a seed, because web and
   * server deploy separately and could hold different generator versions. */
  readonly text: string;
  readonly racers: readonly Racer[];
  /** When the current phase began, in the caller's clock. */
  readonly phaseStartedAt?: number;
  /** When `racing` began — the origin every racer's WPM is measured from. */
  readonly startedAt?: number;
  /**
   * How many racers were present when the race started. Recorded rather than
   * counted later: a racer who leaves mid-race is removed, so the surviving
   * count would under-report what actually happened, and whether a result is
   * ranked depends on this being the truth.
   */
  readonly startedWith?: number;
}

export function racer(state: RaceState, id: string): Racer | undefined {
  return state.racers.find((candidate) => candidate.id === id);
}

/** A racer still typing: present, connected, and not yet across the line. */
export function isRunning(candidate: Racer): boolean {
  return candidate.connected && candidate.finishedAt === undefined;
}
