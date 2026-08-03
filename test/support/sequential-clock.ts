import { Clock } from '../../src/domain/clock';

/**
 * Deterministic Clock test double: each call to now() advances by a fixed
 * step so history timestamps are predictable and strictly increasing,
 * without depending on the real system clock.
 */
export class SequentialClock implements Clock {
  private currentMs: number;

  constructor(startMs = 0, private readonly stepMs = 1000) {
    this.currentMs = startMs;
  }

  now(): Date {
    const result = new Date(this.currentMs);
    this.currentMs += this.stepMs;
    return result;
  }
}
