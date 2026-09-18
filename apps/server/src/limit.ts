/**
 * A fixed-window rate limit, in memory. `SPEC.md` puts this on run submission
 * at step 8: a solo run is a plain HTTP post, so without one anybody can fill
 * the runs table as fast as their connection allows.
 *
 * Twenty lines rather than a dependency, per the rule about both. It never
 * reads the clock — `now` arrives with the call, the same way the race machine
 * takes it — so the behaviour is testable without waiting for real time.
 */

interface Window {
  /** When the current window began. */
  start: number;
  count: number;
}

export class RateLimit {
  private readonly windows = new Map<string, Window>();
  private readonly max: number;
  private readonly windowMs: number;

  /**
   * Written out rather than as parameter properties: the server runs under
   * `node --experimental-strip-types`, which removes types but rewrites
   * nothing, and a parameter property is a rewrite.
   *
   * @param max how many calls one key may make per window
   * @param windowMs how long a window lasts
   */
  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** Records a call and says whether it is allowed. */
  allow(key: string, now: number): boolean {
    const window = this.windows.get(key);
    if (window === undefined || now - window.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= this.max;
  }

  /**
   * Drops windows that have expired. Without this the map grows for the life
   * of the process, one entry per address ever seen.
   */
  sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.windowMs) {
        this.windows.delete(key);
      }
    }
  }

  get size(): number {
    return this.windows.size;
  }
}
