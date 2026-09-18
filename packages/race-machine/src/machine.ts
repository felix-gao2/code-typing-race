import { isRunning, racer, type RaceConfig, type RaceKind, type RaceState } from './state.ts';

/**
 * Everything that can happen to a race from outside. Each carries the moment
 * it happened: the machine never reads a clock, so a caller replaying a
 * recorded event log gets the identical race back.
 */
export type RaceEvent =
  | { readonly type: 'join'; readonly id: string; readonly at: number }
  | { readonly type: 'leave'; readonly id: string; readonly at: number }
  | { readonly type: 'disconnect'; readonly id: string; readonly at: number }
  | { readonly type: 'reconnect'; readonly id: string; readonly at: number }
  | { readonly type: 'progress'; readonly id: string; readonly progress: number; readonly at: number }
  | { readonly type: 'finish'; readonly id: string; readonly at: number };

export interface CreateRace {
  readonly kind: RaceKind;
  readonly text: string;
  readonly config: RaceConfig;
}

export function create({ kind, text, config }: CreateRace): RaceState {
  return { kind, phase: 'waiting', config, text, racers: [] };
}

/**
 * Applies one event. Pure: the state passed in is never mutated, and an event
 * that changes nothing returns the same object, so a caller can tell whether
 * anything moved by identity.
 */
export function apply(state: RaceState, event: RaceEvent): RaceState {
  switch (event.type) {
    case 'join':
      return join(state, event.id, event.at);
    case 'leave':
      return leave(state, event.id);
    case 'disconnect':
      return setConnected(state, event.id, false);
    case 'reconnect':
      return setConnected(state, event.id, true);
    case 'progress':
      return setProgress(state, event.id, event.progress);
    case 'finish':
      return finish(state, event.id, event.at);
  }
}

/**
 * Advances time. Returns the next moment worth calling back at, so scheduling
 * belongs to the caller and this module stays free of timers. `deadline` is
 * `undefined` when the race is waiting on people rather than on the clock.
 */
export function tick(
  state: RaceState,
  now: number,
): { state: RaceState; deadline: number | undefined } {
  const next = advance(state, now);
  return { state: next, deadline: deadlineOf(next) };
}

/** When the caller should next call `tick`, if the clock can move this race. */
export function deadlineOf(state: RaceState): number | undefined {
  if (state.phaseStartedAt === undefined) {
    return undefined;
  }
  if (state.phase === 'countdown') {
    return state.phaseStartedAt + state.config.countdownMs;
  }
  if (state.phase === 'racing') {
    return state.phaseStartedAt + state.config.raceTimeoutMs;
  }
  if (state.phase === 'waiting' && state.config.waitTimeoutMs !== undefined) {
    return state.phaseStartedAt + state.config.waitTimeoutMs;
  }
  return undefined;
}

export function isOver(state: RaceState): boolean {
  return state.phase === 'finished';
}

/**
 * Phase transitions the clock can cause. Looped because one tick can cross
 * more than one boundary — a countdown that expired long ago should land in
 * `racing` and then be timed out, not sit in `countdown` until the next call.
 */
function advance(state: RaceState, now: number): RaceState {
  let current = state;
  for (;;) {
    const deadline = deadlineOf(current);
    if (deadline === undefined || now < deadline) {
      return current;
    }
    const next = onDeadline(current, deadline);
    if (next === current) {
      return current;
    }
    current = next;
  }
}

/**
 * A phase expiring. The deadline is used as the transition time rather than
 * `now`, so a tick that arrives late produces the same race as one that
 * arrived punctually — otherwise a slow server would hand racers a different
 * start time than a fast one.
 */
function onDeadline(state: RaceState, deadline: number): RaceState {
  if (state.phase === 'countdown') {
    return { ...state, phase: 'racing', phaseStartedAt: deadline, startedAt: deadline };
  }
  if (state.phase === 'racing') {
    // The race ran its full length. Whoever is still going is out of time,
    // which is what stops a disconnected racer hanging it forever.
    return { ...state, phase: 'finished', phaseStartedAt: deadline };
  }
  if (state.phase === 'waiting') {
    // Waited long enough. Start with whoever turned up, unless nobody did.
    return state.racers.length === 0
      ? state
      : { ...state, phase: 'countdown', phaseStartedAt: deadline };
  }
  return state;
}

function join(state: RaceState, id: string, at: number): RaceState {
  // A race that has started is not a race you can join. Late arrivals belong
  // in the next one, not partway up this one's leaderboard.
  if (state.phase !== 'waiting') {
    return state;
  }
  if (racer(state, id) !== undefined || state.racers.length >= state.config.maxRacers) {
    return state;
  }

  const racers = [...state.racers, { id, progress: 0, connected: true }];
  const waiting: RaceState = {
    ...state,
    racers,
    // The wait clock starts with the first arrival, not with the empty room.
    phaseStartedAt: state.phaseStartedAt ?? at,
  };

  return racers.length >= state.config.minRacers
    ? { ...waiting, phase: 'countdown', phaseStartedAt: at }
    : waiting;
}

/**
 * Leaving is not disconnecting: it is deliberate, so the racer is removed
 * rather than kept a seat. A countdown that drops back below `minRacers`
 * returns to waiting — starting a race against nobody is worse than waiting.
 */
function leave(state: RaceState, id: string): RaceState {
  if (racer(state, id) === undefined) {
    return state;
  }
  const racers = state.racers.filter((candidate) => candidate.id !== id);

  if (state.phase === 'countdown' && racers.length < state.config.minRacers) {
    return { ...state, racers, phase: 'waiting' };
  }
  if (state.phase === 'racing') {
    return settle({ ...state, racers });
  }
  return { ...state, racers };
}

/**
 * Disconnecting keeps the racer and their progress. They may be mid-word on a
 * train, and a race that ends the instant someone's connection blinks is a
 * race nobody finishes.
 */
function setConnected(state: RaceState, id: string, connected: boolean): RaceState {
  const existing = racer(state, id);
  if (existing === undefined || existing.connected === connected) {
    return state;
  }
  const next = mapRacer(state, id, (candidate) => ({ ...candidate, connected }));
  // Everyone still in it has now either finished or dropped, so there is
  // nobody left to wait for.
  return connected ? next : settle(next);
}

function setProgress(state: RaceState, id: string, progress: number): RaceState {
  const existing = racer(state, id);
  if (state.phase !== 'racing' || existing === undefined || existing.finishedAt !== undefined) {
    return state;
  }
  // Progress only moves forward. A lower number is a stale packet overtaking a
  // newer one, not a racer un-typing.
  const clamped = Math.min(1, Math.max(existing.progress, progress));
  if (clamped === existing.progress) {
    return state;
  }
  return mapRacer(state, id, (candidate) => ({ ...candidate, progress: clamped }));
}

function finish(state: RaceState, id: string, at: number): RaceState {
  const existing = racer(state, id);
  if (state.phase !== 'racing' || existing === undefined || existing.finishedAt !== undefined) {
    return state;
  }
  const next = mapRacer(state, id, (candidate) => ({
    ...candidate,
    progress: 1,
    finishedAt: at,
  }));
  return settle(next);
}

/** Ends the race once nobody is still running. */
function settle(state: RaceState): RaceState {
  if (state.phase !== 'racing' || state.racers.some(isRunning)) {
    return state;
  }
  return { ...state, phase: 'finished' };
}

function mapRacer(
  state: RaceState,
  id: string,
  change: (candidate: RaceState['racers'][number]) => RaceState['racers'][number],
): RaceState {
  return {
    ...state,
    racers: state.racers.map((candidate) => (candidate.id === id ? change(candidate) : candidate)),
  };
}
