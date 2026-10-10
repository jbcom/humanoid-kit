import type { ChromiumGpuMode } from "game-harness/chromium";

/** How this run's browser launches: which GPU path, and whether it opens a window. */
export interface BrowserRun {
  gpuMode: ChromiumGpuMode;
  headless: boolean;
}

/**
 * The one decision both browser configs (vitest's browser project, Playwright) make,
 * from the environment the run was started in. First match wins:
 *
 * 1. `HK_GPU` and `HK_HEADED=1`: a person's explicit override.
 * 2. heavy-slot's priority lane on the owner's Mac (`HEAVY_PRIORITY=1`) sets
 *    `HEAVY_BROWSER_GPU` and `HEAVY_BROWSER_HEADLESS` (`1` headless, `0` headed for
 *    hardware proof); `PW_HEADLESS=1` alone also means headless. The project opts in
 *    to the lane in package.json (`heavySlot.priorityLane`), promising exactly this.
 * 3. The render Macs (`heavy-slot --remote-render` sets `HEAVY_RENDER_HOST`) have a GPU
 *    but no window session: headless, through ANGLE Metal, about 20 times faster than
 *    SwiftShader.
 * 4. Other CI has no GPU worth trusting and no window: headless SwiftShader.
 * 5. Locally: a headed window on the native GPU, so what is tested is what people see.
 *
 * Every launch is muted whatever the path (game-harness always adds `--mute-audio`),
 * which is what `HEAVY_BROWSER_MUTE` asks.
 */
export function browserRun(
  env: Readonly<Record<string, string | undefined>>,
  platform: string,
): BrowserRun {
  const renderMac = Boolean(env.HEAVY_RENDER_HOST) && platform === "darwin";
  const ci = Boolean(env.CI);
  const fallbackGpu: ChromiumGpuMode = renderMac
    ? "macos-hardware-metal"
    : ci
      ? "software"
      : "auto";
  const gpuMode = (env.HK_GPU ?? env.HEAVY_BROWSER_GPU ?? fallbackGpu) as ChromiumGpuMode;

  let headless: boolean;
  if (env.HK_HEADED === "1") headless = false;
  else if (env.HEAVY_BROWSER_HEADLESS === "1" || env.HEAVY_BROWSER_HEADLESS === "0")
    headless = env.HEAVY_BROWSER_HEADLESS === "1";
  else if (env.PW_HEADLESS === "1") headless = true;
  else headless = renderMac || ci;

  return { gpuMode, headless };
}
