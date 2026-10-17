import { describe, expect, it, vi } from "vitest";
import { Settle } from "../src/react/settle.ts";

describe("Settle", () => {
  it("is idle when nothing loads: whenIdle calls back at once", () => {
    const then = vi.fn();
    new Settle().whenIdle(then);
    expect(then).toHaveBeenCalledOnce();
  });

  it("waits for every load in flight, and calls back once the last ends", () => {
    const s = new Settle();
    const first = s.begin();
    const second = s.begin();
    const then = vi.fn();
    s.whenIdle(then);
    first();
    expect(then).not.toHaveBeenCalled();
    second();
    expect(then).toHaveBeenCalledOnce();
  });

  it("counts a load once however often its end is called", () => {
    const s = new Settle();
    const end = s.begin();
    const other = s.begin();
    end();
    end();
    end();
    const then = vi.fn();
    s.whenIdle(then);
    expect(then).not.toHaveBeenCalled();
    other();
    expect(then).toHaveBeenCalledOnce();
  });

  it("does not call back after the wait is cancelled", () => {
    const s = new Settle();
    const end = s.begin();
    const then = vi.fn();
    const cancel = s.whenIdle(then);
    cancel();
    end();
    expect(then).not.toHaveBeenCalled();
  });

  it("waits again when a new load begins before the callback is due", () => {
    const s = new Settle();
    const a = s.begin();
    const then = vi.fn();
    s.whenIdle(then);
    a();
    expect(then).toHaveBeenCalledOnce();
    const b = s.begin();
    const later = vi.fn();
    s.whenIdle(later);
    expect(later).not.toHaveBeenCalled();
    b();
    expect(later).toHaveBeenCalledOnce();
  });
});

/** A hand-driven animation-frame clock: `tick()` runs every callback queued for the next frame. */
function frameClock() {
  let queued: Array<() => void> = [];
  const schedule = (callback: () => void) => {
    queued.push(callback);
    return () => {
      queued = queued.filter((f) => f !== callback);
    };
  };
  const tick = () => {
    const due = queued;
    queued = [];
    for (const f of due) f();
  };
  return { schedule, tick };
}

describe("Settle.afterQuiet", () => {
  it("calls back after the given frames once nothing is loading", () => {
    const s = new Settle();
    const clock = frameClock();
    const then = vi.fn();
    s.afterQuiet(2, then, clock.schedule);
    clock.tick();
    expect(then).not.toHaveBeenCalled();
    clock.tick();
    expect(then).toHaveBeenCalledOnce();
  });

  it("counts its frames from the end of a load that began after the count started", () => {
    // The facial-hair source retry begins in a later commit than the settle that
    // waits on it: its frames must follow that load's end, not precede it.
    const s = new Settle();
    const clock = frameClock();
    const then = vi.fn();
    s.afterQuiet(2, then, clock.schedule);
    clock.tick();
    clock.tick();
    expect(then).toHaveBeenCalledOnce();
    then.mockClear();
    s.afterQuiet(2, then, clock.schedule);
    clock.tick();
    const retry = s.begin();
    clock.tick();
    clock.tick();
    expect(then).not.toHaveBeenCalled();
    retry();
    expect(
      then,
      "a load's end leaves its texture undrawn until frames pass",
    ).not.toHaveBeenCalled();
    clock.tick();
    expect(then).not.toHaveBeenCalled();
    clock.tick();
    expect(then).toHaveBeenCalledOnce();
  });

  it("starts its frames over when a load begins and ends between two frames", () => {
    const s = new Settle();
    const clock = frameClock();
    const then = vi.fn();
    s.afterQuiet(2, then, clock.schedule);
    clock.tick();
    s.begin()();
    clock.tick();
    expect(then).not.toHaveBeenCalled();
    clock.tick();
    expect(then).not.toHaveBeenCalled();
    clock.tick();
    expect(then).toHaveBeenCalledOnce();
  });

  it("never calls back once cancelled, whether waiting on a load or on a frame", () => {
    const s = new Settle();
    const clock = frameClock();
    const then = vi.fn();
    const end = s.begin();
    const cancelWaiting = s.afterQuiet(2, then, clock.schedule);
    cancelWaiting();
    end();
    clock.tick();
    clock.tick();
    const cancelCounting = s.afterQuiet(2, then, clock.schedule);
    clock.tick();
    cancelCounting();
    clock.tick();
    clock.tick();
    expect(then).not.toHaveBeenCalled();
  });
});
