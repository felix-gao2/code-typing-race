import type { Room, Rooms } from './rooms.ts';

/**
 * The bridge between the machine's deadlines and real timers.
 *
 * The race machine deliberately returns a deadline instead of setting a timer,
 * which leaves exactly one place in the system that calls `setTimeout` on a
 * race: this file. Everything upstream stays testable by passing a number.
 */

/** Called whenever a room's state moved on its own, so it can be broadcast. */
export type OnAdvance = (room: Room) => void;

export class Scheduler {
  constructor(
    private readonly rooms: Rooms,
    private readonly onAdvance: OnAdvance,
    /** Injected so tests can drive the clock instead of waiting on one. */
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Brings a room up to the present and arms its next deadline. Safe to call
   * after every event: an unchanged deadline re-arms the same moment, and a
   * room with nothing pending simply ends up with no timer.
   */
  sync(id: string): void {
    const advanced = this.rooms.advance(id, this.now());
    if (advanced === undefined) {
      return;
    }
    const { room, deadline, moved } = advanced;

    if (moved) {
      this.onAdvance(room);
    }

    this.arm(room, deadline);
  }

  /** Cancels a room's pending timer without touching the room itself. */
  cancel(room: Room): void {
    if (room.timer !== undefined) {
      clearTimeout(room.timer);
      room.timer = undefined;
    }
  }

  private arm(room: Room, deadline: number | undefined): void {
    this.cancel(room);
    if (deadline === undefined) {
      return;
    }

    // A deadline already in the past means the state machine has more to do
    // than one pass could finish; zero rather than a negative delay, and the
    // next sync picks it up.
    const delay = Math.max(0, deadline - this.now());
    room.timer = setTimeout(() => {
      room.timer = undefined;
      this.sync(room.id);
    }, delay);

    // A pending race deadline should never hold the process open by itself.
    room.timer.unref?.();
  }
}
