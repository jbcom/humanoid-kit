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
