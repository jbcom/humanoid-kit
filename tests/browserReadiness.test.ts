import { describe, expect, it } from "vitest";
import { type ReadinessClock, waitForPhase } from "./browser/waitForPhase.ts";

function delayedWake(readyAfterWake: boolean) {
  let now = 0;
  let ready = false;
  const waits: number[] = [];
  const clock: ReadinessClock = {
    now: () => now,
    pause: async (milliseconds) => {
      waits.push(milliseconds);
      // Queued browser work completes before a delayed polling timer wakes.
      now = 30_001;
      ready = readyAfterWake;
    },
  };
  return { clock, waits, ready: () => ready };
}

describe("browser readiness deadline", () => {
  it("accepts completed readiness on a delayed wake instead of throwing a ready receipt", async () => {
    const wake = delayedWake(true);
    await expect(
      waitForPhase("evaluated body", wake.ready, () => ({ evaluated: wake.ready() }), wake.clock),
    ).resolves.toBeUndefined();
    expect(wake.waits).toEqual([50]);
  });

  it("still rejects an incomplete phase at the same deadline with its diagnostic receipt", async () => {
    const wake = delayedWake(false);
    await expect(
      waitForPhase("evaluated body", wake.ready, () => ({ evaluated: wake.ready() }), wake.clock),
    ).rejects.toThrow('posed-fluid probe evaluated body timed out: {"evaluated":false}');
    expect(wake.waits).toEqual([50]);
  });

  it("accepts an already complete phase without scheduling more work", async () => {
    const wake = delayedWake(false);
    await expect(
      waitForPhase(
        "evaluated body",
        () => true,
        () => null,
        wake.clock,
      ),
    ).resolves.toBeUndefined();
    expect(wake.waits).toEqual([]);
  });
});
