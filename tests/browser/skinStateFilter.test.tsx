import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { useSkinStateFilter } from "../../src/react/useSkinStateFilter.ts";

// Quick rates, so the tests wait tenths of a second rather than the real time courses.
const FAST = { cold: { attack: 0.08, decay: 0.08 }, heat: { attack: 0.08, decay: 0.08 } };

function Probe({
  target,
  seen,
  initial,
}: {
  target: Record<string, number>;
  seen: Record<string, number>[];
  initial?: "target" | "rest";
}) {
  const value = useSkinStateFilter(target, { rates: FAST, initial });
  seen.push(value);
  return <output>{JSON.stringify(value)}</output>;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe("useSkinStateFilter", () => {
  it("starts at the target, so a figure that mounts in a state does not animate into it", async () => {
    const seen: Record<string, number>[] = [];
    await render(<Probe target={{ cold: 1 }} seen={seen} />);
    expect(seen[0]?.cold).toBe(1);
    await sleep(100);
    expect(seen.at(-1)?.cold).toBe(1);
  });

  it("can start at rest and ease in instead", async () => {
    const seen: Record<string, number>[] = [];
    await render(<Probe target={{ cold: 1 }} seen={seen} initial="rest" />);
    expect(seen[0]?.cold ?? 0).toBe(0);
    await expect.poll(() => seen.at(-1)?.cold).toBe(1);
    const rising = seen.map((s) => s.cold ?? 0);
    expect(rising.length).toBeGreaterThan(3);
    for (let i = 1; i < rising.length; i++)
      expect(rising[i], `frame ${i}`).toBeGreaterThanOrEqual(rising[i - 1] as number);
  });

  it("eases to a new target in between, and settles on it", async () => {
    const seen: Record<string, number>[] = [];
    const screen = await render(<Probe target={{ cold: 1, heat: 0.5 }} seen={seen} />);
    seen.length = 0;
    await screen.rerender(<Probe target={{ cold: 0, heat: 0.5 }} seen={seen} />);
    await expect.poll(() => seen.at(-1)?.cold).toBe(0);
    const falling = seen.map((s) => s.cold ?? 0);
    expect(falling.some((c) => c > 0.05 && c < 0.95)).toBe(true);
    for (let i = 1; i < falling.length; i++)
      expect(falling[i], `frame ${i}`).toBeLessThanOrEqual(falling[i - 1] as number);
    // A signal that did not change did not move.
    expect(new Set(seen.map((s) => s.heat)).size).toBe(1);
  });

  it("stops rendering once it has settled, rather than ticking forever", async () => {
    const seen: Record<string, number>[] = [];
    const screen = await render(<Probe target={{ cold: 0 }} seen={seen} />);
    await screen.rerender(<Probe target={{ cold: 1 }} seen={seen} />);
    await expect.poll(() => seen.at(-1)?.cold).toBe(1);
    await sleep(50);
    const count = seen.length;
    await sleep(300);
    expect(seen.length).toBe(count);
  });

  it("does not restart for a new object with the same entries", async () => {
    const seen: Record<string, number>[] = [];
    const screen = await render(<Probe target={{ cold: 0 }} seen={seen} />);
    await screen.rerender(<Probe target={{ cold: 1 }} seen={seen} />);
    await sleep(20);
    const mid = seen.at(-1)?.cold as number;
    expect(mid).toBeGreaterThan(0);
    await screen.rerender(<Probe target={{ cold: 1 }} seen={seen} />);
    // Still on its way up, not back at 0.
    expect(seen.at(-1)?.cold as number).toBeGreaterThanOrEqual(mid);
  });
});
