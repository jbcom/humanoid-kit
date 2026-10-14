/** Test-only clock for deterministic browser scheduling diagnostics. */
export interface ReadinessClock {
  now(): number;
  pause(milliseconds: number): Promise<void>;
}

const browserClock: ReadinessClock = {
  now: () => performance.now(),
  pause: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export async function waitForPhase(
  name: string,
  ready: () => boolean,
  receipt: () => unknown,
  clock: ReadinessClock = browserClock,
): Promise<void> {
  const end = clock.now() + 30_000;
  // Busy browser work may finish before a timer wakes beyond its deadline.
  // Inspect that completed state before diagnosing a genuinely incomplete phase.
  while (!ready()) {
    if (clock.now() >= end)
      throw new Error(`posed-fluid probe ${name} timed out: ${JSON.stringify(receipt())}`);
    await clock.pause(50);
  }
}
