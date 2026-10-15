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
 * 2. A runner can supply `HEAVY_BROWSER_GPU` and `HEAVY_BROWSER_HEADLESS`
 *    (`1` headless, `0` headed for hardware proof); `PW_HEADLESS=1` alone also
 *    means headless. These runner overrides do not require a particular CLI.
 * 3. A macOS runner with `HEAVY_RENDER_HOST` set defaults to headless ANGLE Metal
 *    for its Apple GPU without requiring a window session.
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
