/**
 * The time a skin state takes to rise and fall (docs/ARCHITECTURE.md, "Skin
 * states"). The library maps signals to appearance; a signal an application
 * sets is a step (a stimulus on or off), but a body takes time to answer one:
 * a goosebump episode lasts about ten seconds, a blush builds in seconds and
 * fades in tens, a sweat in minutes. This is the small, pure filter between
 * the two: each signal follows its target by a first-order response, with one
 * time constant to rise and another to fall.
 *
 * `stepSkinState` is the response, integrated exactly, so any frame rate gives
 * the same curve. `SkinStateFilter` holds the state between frames. The React
 * hook `useSkinStateFilter` (humanoid-kit/react) runs one for a component.
 */

/** Time constants in seconds: how long a signal takes to cover 63% of the way to its target. */
export interface StateRate {
  /** Rising toward a higher target. */
  attack: number;
  /** Falling toward a lower one. */
  decay: number;
}

/**
 * Per-signal rates; a CHOICE where marked (docs/research/SKIN-STATES.md C4).
 *
 * - `cold`, `fear`: calibrated to the measured piloerection episode. A trigger
 *   of 3 s leaves the intensity above a tenth for 11 to 12 s, in the 9 to 13 s
 *   McPhetres et al. 2024 measured (mean 10.1 s; small 9.0, large 13.2).
 * - `blush`: comes in seconds and goes in tens of them (CHOICE).
 * - `exertion`: skin blood flow follows exercise over tens of seconds, and
 *   recovers more slowly (CHOICE).
 * - `heat`: sweating and cutaneous vasodilation follow body temperature over
 *   minutes (CHOICE).
 */
export const STATE_TIME_CONSTANTS: Readonly<Record<string, StateRate>> = {
  cold: { attack: 1.5, decay: 4 },
  fear: { attack: 0.8, decay: 4 },
  blush: { attack: 2, decay: 15 },
  exertion: { attack: 20, decay: 60 },
  heat: { attack: 40, decay: 90 },
};

/** A signal with no rate of its own (arousal, a joint's flexion, an application's own) moves at this. */
export const DEFAULT_STATE_RATE: Readonly<StateRate> = { attack: 2, decay: 5 };

/** Within this of its target a signal is there: it snaps, so a settled state stops changing. */
const SNAP = 1e-3;

const unit = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Moves each signal in `current` toward its value in `target` (both 0..1; a
 * missing one is 0) over `dt` seconds, by the exact first-order response. A
 * signal that appears only in `target` starts from 0; one that appears only in
 * `current` falls toward 0. `rates` replace `STATE_TIME_CONSTANTS`.
 */
export function stepSkinState(
  current: Readonly<Record<string, number>>,
  target: Readonly<Record<string, number>>,
  dt: number,
  rates: Readonly<Record<string, StateRate>> = STATE_TIME_CONSTANTS,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of new Set([...Object.keys(current), ...Object.keys(target)])) {
    const from = unit(current[name] ?? 0);
    const to = unit(target[name] ?? 0);
    const rate = rates[name] ?? DEFAULT_STATE_RATE;
    const tau = to >= from ? rate.attack : rate.decay;
    const next = dt > 0 ? to + (from - to) * Math.exp(-dt / tau) : from;
    out[name] = Math.abs(next - to) < SNAP ? to : next;
  }
  return out;
}

/** The filter's state between frames. */
export class SkinStateFilter {
  private state: Record<string, number>;
  private readonly rates: Readonly<Record<string, StateRate>>;

  /** `rates` replace `STATE_TIME_CONSTANTS`; `initial` is the state it starts in (at rest by default). */
  constructor(
    rates: Readonly<Record<string, StateRate>> = STATE_TIME_CONSTANTS,
    initial: Readonly<Record<string, number>> = {},
  ) {
    this.rates = rates;
    this.state = { ...initial };
  }

  /** The filtered signals now: a copy. */
  get value(): Record<string, number> {
    return { ...this.state };
  }

  /** Advances `dt` seconds toward `target` and returns the filtered signals: a copy. */
  step(target: Readonly<Record<string, number>>, dt: number): Record<string, number> {
    this.state = stepSkinState(this.state, target, dt, this.rates);
    return this.value;
  }

  /** Whether every signal is at its target, so there is nothing left to animate. */
  settled(target: Readonly<Record<string, number>>): boolean {
    for (const name of new Set([...Object.keys(this.state), ...Object.keys(target)]))
      if (Math.abs(unit(this.state[name] ?? 0) - unit(target[name] ?? 0)) >= SNAP) return false;
    return true;
  }

  /** Jumps to `state` (at rest by default), without the time it would take. */
  reset(state: Readonly<Record<string, number>> = {}): void {
    this.state = { ...state };
  }
}
