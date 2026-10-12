/**
 * Animation in the browser: a clip poses the skinned figure at a time, and a
 * walking figure is carried forward on its own feet with the feet it plants
 * staying planted. Read from the bones the renderer skins (`window.hkBone`) and
 * the group that carries the figure (`window.hkFigure`), frame by frame.
 */
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import { budget } from "./budget.ts";

type Vec3 = [number, number, number];
type ContactPoint = "heel" | "ballInner" | "ballOuter";
type ContactFrame = { generation: number; time: number; contacts: Contact[] };
type Contact = {
  side: "left" | "right";
  point: ContactPoint;
  position: Vec3;
  owned: boolean;
  hold: number;
};

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

/** Retained only with the hitch regression, so a passing run still leaves reviewable motion states. */
async function captureAnimationState(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const out = testInfo.outputPath(`${name}.png`);
  await page.locator("canvas").screenshot({ path: out });
  await testInfo.attach(name, { path: out, contentType: "image/png" });
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
    // Sample FootLock's actual, world-space sole contacts every rendered frame.
    // A gait rolls heel -> inner/outer ball, so a particular toe joint is not a stance contract.
    const samples = await page.evaluate(
      (seconds) =>
        new Promise<{ t: number; contacts: Contact[]; at: Vec3 }[]>((done) => {
          const out: { t: number; contacts: Contact[]; at: Vec3 }[] = [];
          const t0 = performance.now();
          const tick = () => {
            const contacts = window.hkContacts?.() as ContactFrame | null | undefined;
            const at = window.hkFigure?.()?.position;
            if (contacts && at)
              out.push({
                t: performance.now() - t0,
                contacts: contacts.contacts,
                at: at as Vec3,
              });
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
    // FootLock pins from the first frame; its own unit contract samples after the first
    // full cycle, once those initial pins have settled. Keep the five-second observation
    // window and the same 40 mm limit for every subsequent held contact.
    const settledSamples = samples.filter((sample) => sample.t >= 1000);
    for (const side of ["left", "right"] as const) {
      let start0 = -1;
      let point: ContactPoint | null = null;
      let worst = 0;
      let stances = 0;
      for (let i = 0; i <= settledSamples.length; i++) {
        const contact =
          i < settledSamples.length
            ? settledSamples[i]?.contacts.find(
                (candidate) => candidate.side === side && candidate.owned && candidate.hold === 1,
              )
            : undefined;
        const held = contact !== undefined && contact.point === point;
        if (contact && (start0 < 0 || !held)) {
          if (start0 >= 0 && i - start0 >= 5) {
            stances++;
            for (let k = start0; k < i; k++) {
              const at = settledSamples[k]?.contacts.find(
                (candidate) => candidate.side === side && candidate.point === point,
              );
              const first = settledSamples[start0]?.contacts.find(
                (candidate) => candidate.side === side && candidate.point === point,
              );
              if (at && first)
                worst = Math.max(
                  worst,
                  Math.hypot(
                    at.position[0] - first.position[0],
                    at.position[2] - first.position[2],
                  ),
                );
            }
          }
          start0 = i;
          point = contact.point;
        } else if (!contact && start0 >= 0) {
          if (i - start0 >= 5) {
            stances++;
            for (let k = start0; k < i; k++) {
              const at = settledSamples[k]?.contacts.find(
                (candidate) => candidate.side === side && candidate.point === point,
              );
              const first = settledSamples[start0]?.contacts.find(
                (candidate) => candidate.side === side && candidate.point === point,
              );
              if (at && first)
                worst = Math.max(
                  worst,
                  Math.hypot(
                    at.position[0] - first.position[0],
                    at.position[2] - first.position[2],
                  ),
                );
            }
          }
          start0 = -1;
          point = null;
        }
      }
      expect(stances, `${side} fully planted stretches`).toBeGreaterThanOrEqual(2);
      // The figure's group moves in the world with the feet in it, so a fully held sole stays fixed.
      expect(worst, `${side} fully planted sole moved, metres`).toBeLessThan(0.04);
    }
  });

  test("keeps the walk's distance when one render frame is slow", async ({ page }, testInfo) => {
    await openSilentGame(page, "./", {
      cam: "0,1.15,5.8,0,0.88,0",
      groundQa: 1,
    });
    await show(page, { clip: "walk_normal", time: 0, paused: true, rootMotion: false });
    const priorGeneration = await page.evaluate(() => window.hkContacts?.()?.generation ?? -1);
    await captureAnimationState(page, testInfo, "walk-pre-hitch");
    await show(page, { clip: "walk_normal" });
    const currentGeneration = await page.evaluate(() => window.hkContacts?.()?.generation ?? -1);
    expect(
      currentGeneration,
      "the resumed same-id clip is bound to its replacement evaluation",
    ).toBeGreaterThan(priorGeneration);
    const moved = await page.evaluate(
      (stall) =>
        new Promise<number>((done) => {
          requestAnimationFrame(() => {
            const before = window.hkFigure?.()?.position[2];
            const until = performance.now() + stall;
            while (performance.now() < until) {
              // Deliberately reproduce a render hitch without changing the animation clock.
            }
            requestAnimationFrame(() => {
              const after = window.hkFigure?.()?.position[2];
              done((after ?? Number.NaN) - (before ?? Number.NaN));
            });
          });
        }),
      300,
    );
    // `walk_normal` carries an average figure about 0.665 m/s. A 300 ms frame must
    // advance more than the 100 ms cap that would make the renderer fall behind its clock.
    expect(moved, "walk distance across a 300 ms render frame").toBeGreaterThan(0.15);
    await captureAnimationState(page, testInfo, "walk-after-hitch");
    await show(page, { clip: "walk_normal", time: 0.3, paused: true, rootMotion: false });
    await captureAnimationState(page, testInfo, "walk-foot-contact");
  });

  test("plays a retargeted Quaternius clip: a walk carries the figure on its feet, a swim lays it flat", async ({
    page,
  }) => {
    await openSilentGame(page, "./", { bg: "00ff00", cam: "0,0.95,3.2,0,0.88,0" });
    // The walk: legs a stride apart half a cycle on, and the figure carried forward.
    const feet = async (time: number) => {
      await show(page, { clip: "walk_loop", time, paused: true, rootMotion: false });
      return { left: await bone(page, "foot.L"), right: await bone(page, "foot.R") };
    };
    const a = await feet(0.05);
    const b = await feet(0.7);
    expect(Math.abs(a.left[2] - b.left[2]), "left foot, z").toBeGreaterThan(0.2);
    expect(Math.sign(a.left[2] - a.right[2])).toBe(-Math.sign(b.left[2] - b.right[2]));
    await show(page, { clip: "walk_loop" });
    const start = await page.evaluate(() => window.hkFigure?.()?.position as Vec3);
    await page.waitForTimeout(2500);
    const end = await page.evaluate(() => window.hkFigure?.()?.position as Vec3);
    expect(end[2] - start[2], "carried forward, metres").toBeGreaterThan(0.8);
    // The swim: the body is horizontal, the head about as high as the feet, not a standing figure's metre and a half above them.
    await show(page, { clip: "swim_fwd_loop", time: 0.3, paused: true, rootMotion: false });
    const head = await bone(page, "head");
    const foot = await bone(page, "foot.L");
    expect(Math.abs(head[1] - foot[1]), "head above foot, metres").toBeLessThan(0.5);
    expect(Math.abs(head[2] - foot[2]), "head from foot along the body, metres").toBeGreaterThan(1);
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
