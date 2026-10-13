import { afterEach, describe, expect, it, vi } from "vitest";
import { yieldWorkerTask } from "../src/worker/task.ts";

describe("the worker task yield", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses one asynchronous message task and closes both ports", async () => {
    const order: string[] = [];
    let closed = 0;
    class TestChannel {
      readonly port1 = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        close: () => closed++,
      };
      readonly port2 = {
        postMessage: () => {
          order.push("posted");
          queueMicrotask(() => this.port1.onmessage?.({} as MessageEvent));
        },
        close: () => closed++,
      };
    }
    vi.stubGlobal("MessageChannel", TestChannel);

    const task = yieldWorkerTask().then(() => order.push("resumed"));
    order.push("after-call");
    expect(order).toEqual(["posted", "after-call"]);
    await task;
    expect(order).toEqual(["posted", "after-call", "resumed"]);
    expect(closed).toBe(2);
  });

  it("does not collapse the fairness boundary into a microtask", async () => {
    let resumed = false;
    const task = yieldWorkerTask().then(() => (resumed = true));

    await Promise.resolve();
    await Promise.resolve();
    expect(resumed).toBe(false);

    await new Promise<void>((resolve) => setImmediate(resolve));
    await task;
    expect(resumed).toBe(true);
  });

  it("falls back to a zero-delay timer only when MessageChannel is unavailable", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("MessageChannel", undefined);
    let resumed = false;
    const task = yieldWorkerTask().then(() => (resumed = true));
    await vi.advanceTimersByTimeAsync(0);
    await task;
    expect(resumed).toBe(true);
  });
});
