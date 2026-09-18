import type { Language } from '@ctr/generator';
import type { RaceConfig } from '@ctr/race-machine';
import type { Room, Rooms } from './rooms.ts';

/**
 * Public matchmaking: find a race to drop someone into, or open one.
 *
 * There is no queue. A waiting public race *is* the queue, which means a racer
 * who arrives second joins the first one's race rather than the two of them
 * sitting in separate lobbies waiting for each other.
 */

export interface MatchRequest {
  readonly language: Language;
  readonly lines: number;
}

export class Matchmaker {
  private readonly rooms: Rooms;
  private readonly config: RaceConfig;

  constructor(rooms: Rooms, config: RaceConfig) {
    this.rooms = rooms;
    this.config = config;
  }

  /**
   * The room this racer should join. Picks the race closest to starting — the
   * one with the most racers already in it — so people pool into one race
   * instead of spreading thinly across several half-empty ones.
   */
  find(request: MatchRequest, now: number): Room {
    const open = this.rooms.joinablePublic(request.language, request.lines);

    const fullest = open.reduce<Room | undefined>(
      (best, room) =>
        best === undefined || room.state.racers.length > best.state.racers.length ? room : best,
      undefined,
    );

    return (
      fullest ??
      this.rooms.open(
        { language: request.language, lines: request.lines, config: this.config, kind: 'public' },
        now,
      )
    );
  }
}
