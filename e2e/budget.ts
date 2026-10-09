/**
 * Test time budgets by renderer. Budgets are written for a GPU; under
 * software rendering (CI's SwiftShader, see playwright.config.ts) every frame
 * of the skin shader costs several times more, and parallel workers share the
 * runner's CPU, so the same steps take about four times as long.
 */
const software = (process.env.HK_GPU ?? (process.env.CI ? "software" : "auto")) === "software";

export const budget = (gpuMs: number): number => (software ? gpuMs * 4 : gpuMs);
