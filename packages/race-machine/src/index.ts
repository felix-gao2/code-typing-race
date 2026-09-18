/**
 * The race state machine: `waiting -> countdown -> racing -> finished`.
 *
 * No sockets, no timers, no clock. Time arrives as `tick(now)` and leaves as a
 * deadline the caller is expected to schedule, so the same code runs on the
 * server, in the race UI, and in a test that fast-forwards an hour in one call.
 *
 * A racer's progress arrives as a number rather than a keystream, so this
 * module does not depend on the typing engine and a race can be exercised
 * without typing anything.
 */

export {
  apply,
  create,
  deadlineOf,
  isOver,
  tick,
  type CreateRace,
  type RaceEvent,
} from './machine.ts';
export {
  isRunning,
  racer,
  type Phase,
  type RaceConfig,
  type RaceKind,
  type Racer,
  type RaceState,
} from './state.ts';
