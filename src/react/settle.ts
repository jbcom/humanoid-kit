/**
 * Knows when a `<Humanoid>` has everything its recipe wears drawn.
 *
 * `onEvaluated` fires when the worker's reply is written to the geometry, but
 * several parts arrive after it: a hair style's strand map, an attachment's or a
 * garment's textures, and the attachments' occlusion at every pose corner. Each
 * registers while it loads (`begin`), and the figure is *settled* once the last
 * of them is done (`onSettled`), which is what a screenshot or a test should
 * wait for.
 */
import { createContext, useContext } from "react";

export class Settle {
  private pending = 0;
  /** Counts every load ever begun, so a load that began and ended unseen is still noticed. */
  private generation = 0;
  private waiting = new Set<() => void>();

  /** Registers one load in flight; call the returned function once it ends (calling it again does nothing). */
  begin(): () => void {
    this.pending++;
    this.generation++;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.pending--;
      if (this.pending === 0) for (const f of [...this.waiting]) f();
    };
  }

  /** Calls `then` once nothing is loading (at once if nothing is); returns a cancel function. */
  whenIdle(then: () => void): () => void {
    if (this.pending === 0) {
      then();
      return () => {};
    }
    const f = () => {
      this.waiting.delete(f);
      then();
    };
    this.waiting.add(f);
    return () => this.waiting.delete(f);
  }

  /**
   * Calls `then` once `frames` animation frames have passed with nothing loading:
   * the frames count from the end of the last load, so a texture that arrives
   * while they are counted is uploaded and drawn before `then`. A load that
   * begins during the count (even one that also ends before the next frame)
   * starts the count over from its end. Returns a cancel function.
   */
  afterQuiet(
    frames: number,
    then: () => void,
    schedule: FrameScheduler = animationFrame,
  ): () => void {
    let live = true;
    let cancelIdle = () => {};
    let cancelFrame = () => {};
    const count = (left: number, generation: number) => {
      if (!live) return;
      if (this.pending > 0 || this.generation !== generation) {
        wait();
        return;
      }
      if (left === 0) {
        live = false;
        then();
        return;
      }
      cancelFrame = schedule(() => count(left - 1, generation));
    };
    const wait = () => {
      cancelIdle = this.whenIdle(() => count(frames, this.generation));
    };
    wait();
    return () => {
      live = false;
      cancelIdle();
      cancelFrame();
    };
  }
}

/** Queues `callback` for the next animation frame; returns a cancel function. */
export type FrameScheduler = (callback: () => void) => () => void;

function animationFrame(callback: () => void): () => void {
  const id = requestAnimationFrame(() => callback());
  return () => cancelAnimationFrame(id);
}

/** The nearest `<Humanoid>`'s settle tracker, which its parts register their loads with. */
export const SettleContext = createContext<Settle | null>(null);

/** The tracker to register a load with, or an inert one outside a `<Humanoid>`. */
export function useSettle(): Settle {
  return useContext(SettleContext) ?? INERT;
}

const INERT = new Settle();
