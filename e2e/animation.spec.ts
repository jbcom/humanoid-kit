/**
 * Animation in the browser: a clip poses the skinned figure at a time, and a
 * walking figure is carried forward on its own feet with the feet it plants
 * staying planted. Read from the bones the renderer skins (`window.hkBone`) and
 * the group that carries the figure (`window.hkFigure`), frame by frame.
 */
import { expect, type Page, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import { budget } from "./budget.ts";

type Vec3 = [number, number, number];

async function bone(page: Page, name: string): Promise<Vec3> {
  const at = await page.evaluate((n) => window.hkBone?.(n) ?? null, name);
  if (!at) throw new Error(`no bone ${name}`);
  return at;
}

/** Waits until the shot reports ready for the generation `hkSetRecipe` just started. */
async function show(
  page: Page,
  animation: { clip: string; time?: number; paused?: boolean; rootMotion?: boolean },
  recipe: object = {},
): Promise<void> {
  const generation = await page.evaluate(
    ({ recipe, animation }) => {
      const set = window.hkSetRecipe;
      if (!set) throw new Error("the QA shot is not mounted");
      const next =
        Number(document.querySelector("[data-generation]")?.getAttribute("data-generation")) + 1;
      set(recipe, { animation });
      return next;
    },
    { recipe, animation },
  );
  await page
    .locator(`[data-figure="ready"][data-generation="${generation}"]`)
    .waitFor({ timeout: budget(60_000) });
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let frames = 0;
        const tick = () => (++frames >= 3 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );
}

test.describe("a clip on the figure", () => {
  test("poses the skinned figure at the time asked: the feet are where the clip has them, and the figure stands on the ground", async ({
    page,
  }) => {
    await openSilentGame(page, "./", { bg: "00ff00", cam: "0,0.95,3.2,0,0.88,0" });
    const feet = async (time: number) => {
      await show(page, { clip: "walk_normal", time, paused: true, rootMotion: false });
      const left = await bone(page, "foot.L");
      const right = await bone(page, "foot.R");
      const lift = await page.evaluate(() => window.hkFigure?.()?.groundOffset ?? Number.NaN);
      return { left, right, lift };
    };
    const a = await feet(0.05);
    const b = await feet(0.55);
    // A stride apart: each foot is well forward or back of where it was half a cycle on, and the legs swap.
    expect(Math.abs(a.left[2] - b.left[2]), "left foot, z").toBeGreaterThan(0.2);
    expect(Math.abs(a.right[2] - b.right[2]), "right foot, z").toBeGreaterThan(0.2);
    expect(Math.sign(a.left[2] - a.right[2])).toBe(-Math.sign(b.left[2] - b.right[2]));
    // On the ground: the lowest sole is at y = 0 within a centimetre, in both poses.
    for (const s of [a, b]) {
      expect(s.lift).toBeGreaterThan(0);
      expect(
        Math.min(s.left[1], s.right[1]) - 0.07,
        "the lower ankle is a sole's height up",
      ).toBeLessThan(0.03);
      expect(Math.min(s.left[1], s.right[1])).toBeGreaterThan(0.03);
    }
  });

  test("carries a walking figure forward, its planted feet staying planted", async ({ page }) => {
    await openSilentGame(page, "./", { bg: "00ff00", cam: "0,0.95,3.2,0,0.88,0" });
    await show(page, { clip: "walk_normal" });
    const start = await page.evaluate(() => window.hkFigure?.()?.position as Vec3);
    // Sample both balls of the feet on every rendered frame for a few cycles.
    const samples = await page.evaluate(
      (seconds) =>
        new Promise<{ t: number; l: Vec3; r: Vec3; at: Vec3 }[]>((done) => {
          const out: { t: number; l: Vec3; r: Vec3; at: Vec3 }[] = [];
          const t0 = performance.now();
          const tick = () => {
            const l = window.hkBone?.("toe1-1.L");
            const r = window.hkBone?.("toe1-1.R");
            const at = window.hkFigure?.()?.position;
            if (l && r && at) out.push({ t: performance.now() - t0, l, r, at: at as Vec3 });
            if (performance.now() - t0 < seconds * 1000) requestAnimationFrame(tick);
            else done(out);
          };
          requestAnimationFrame(tick);
        }),
      5,
    );
    const end = samples[samples.length - 1]?.at as Vec3;
    // Forward along the figure's own axis (+z), a stride or more a second's worth, and no sideways drift.
    expect(end[2] - start[2], "carried forward, metres").toBeGreaterThan(1.5);
    expect(Math.abs(end[0] - start[0]), "sideways").toBeLessThan(0.1);
    expect(samples.length, "frames sampled").toBeGreaterThan(20);
    // A planted ball: the joint's height is within 6 mm of the lowest it reaches, over at least 5 frames
    // (the joint rolls over the sole as the foot does, so this is looser than the unit test's sole points).
    for (const side of ["l", "r"] as const) {
      const heights = samples.map((s) => s[side][1]);
      const low = Math.min(...heights);
      let start0 = -1;
      let worst = 0;
      let stances = 0;
      for (let i = 0; i <= samples.length; i++) {
        const planted = i < samples.length && (heights[i] as number) - low < 0.006;
        if (planted && start0 < 0) start0 = i;
        if (!planted && start0 >= 0) {
          if (i - start0 >= 5) {
            stances++;
            for (let k = start0; k < i; k++)
              worst = Math.max(
                worst,
                Math.hypot(
                  (samples[k] as (typeof samples)[number])[side][0] -
                    (samples[start0] as (typeof samples)[number])[side][0],
                  (samples[k] as (typeof samples)[number])[side][2] -
                    (samples[start0] as (typeof samples)[number])[side][2],
                ),
              );
          }
          start0 = -1;
        }
      }
      expect(stances, `${side} planted stretches`).toBeGreaterThanOrEqual(2);
      // The figure's group moves in the world with the bones in it, so a planted ball's world position is fixed.
      expect(worst, `${side} ball moved while planted, metres`).toBeLessThan(0.04);
    }
  });

  test("holds a still when paused, and a walk on the spot when told not to carry the figure", async ({
    page,
  }) => {
    await openSilentGame(page, "./", { bg: "00ff00", cam: "0,0.95,3.2,0,0.88,0" });
    await show(page, { clip: "walk_normal", rootMotion: false });
    const a = await page.evaluate(() => window.hkFigure?.()?.position as Vec3);
    await page.waitForTimeout(1500);
    const b = await page.evaluate(() => window.hkFigure?.()?.position as Vec3);
    expect(Math.abs(b[2] - a[2]), "on the spot").toBeLessThan(1e-6);
    await show(page, { clip: "walk_normal", time: 0.3, paused: true });
    const still = await bone(page, "foot.L");
    await page.waitForTimeout(500);
    expect(await bone(page, "foot.L")).toEqual(still);
  });
});
