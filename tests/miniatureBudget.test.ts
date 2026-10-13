/**
 * The miniature budgets of issue #12, as numbers (docs/MINIATURES.md): a table of
 * 600 figures of four archetypes, each baked with three clips, must stay within
 * 20 draw calls and 250 k triangles, an archetype's animation textures within
 * 4 MB and its binary within 1.5 MB transferred.
 */
import { gzipSync } from "node:zlib";
import { PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { encodeMiniature } from "../src/bake/format.ts";
import { bakeMiniature, type MiniatureBake } from "../src/bake/miniature.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { MiniatureCrowd, type MiniatureFigure, projectedPixels } from "../src/render/miniature.ts";
import { clip } from "./animationHarness.ts";
import { loadMiniatureAssets } from "./fixtures.ts";

const MB = 1024 * 1024;

describe("the miniature budgets", { timeout: 600_000 }, () => {
  const assets = loadMiniatureAssets();
  const model = new HumanoidModel(assets, { subdivision: 0 });
  const clips = [
    { name: "walk", clip: clip("walk_loop") },
    { name: "idle", clip: clip("idle_loop") },
    { name: "crouch", clip: clip("crouch_idle_loop") },
  ];
  const outfits = [
    ["suits/male_worksuit01", "shoes/shoes01", "hats/fedora01"],
    ["suits/male_casualsuit02", "shoes/shoes02"],
    ["suits/female_sportsuit01", "shoes/shoes04"],
    ["suits/male_elegantsuit01", "shoes/shoes03"],
  ];
  let bakes: MiniatureBake[] | undefined;
  const archetypes = () => {
    bakes ??= outfits.map((outfit) => bakeMiniature(model, createRecipe({ outfit }), { clips }));
    return bakes;
  };

  /** 600 figures in brigade stands over a 60 m × 60 m table. */
  const table = (): MiniatureFigure[] =>
    Array.from({ length: 600 }, (_, i) => ({
      archetype: i % 4,
      x: (i % 30) * 2 - 30,
      z: Math.floor(i / 30) * 3 - 30,
      clip: ["walk", "idle", "crouch"][i % 3] as string,
      phase: (i * 0.37) % 2,
      scale: i % 50 === 0 ? 1.6 : 1,
    }));

  const overTable = () => {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.5, 500);
    camera.position.set(0, 22, 42);
    camera.lookAt(0, 0, -5);
    return camera;
  };

  it("keeps each archetype's animation textures under 4 MB and its binary under 1.5 MB", () => {
    for (const bake of archetypes()) {
      const crowd = new MiniatureCrowd([bake]);
      expect(crowd.textureBytes).toBeLessThan(4 * MB);
      crowd.dispose();
      const transferred = gzipSync(encodeMiniature(bake), { level: 9 }).byteLength;
      expect(transferred).toBeLessThan(1.5 * MB);
    }
  });

  it("draws a 600-figure table in at most 20 calls and 250 k triangles", () => {
    const crowd = new MiniatureCrowd(archetypes(), { maxFigures: 600 });
    crowd.setFigures(table());
    const stats = crowd.update(overTable(), 1.25, 1080);
    expect(stats.visible).toBeGreaterThan(300);
    expect(stats.drawCalls).toBeLessThanOrEqual(20);
    expect(stats.drawCalls).toBeLessThanOrEqual(4 * 2);
    expect(stats.triangles).toBeLessThanOrEqual(250_000);
    // The nearest stands get the near level; the far ones the far level.
    expect(stats.perLevel[0]).toBeGreaterThan(0);
    expect(stats.perLevel[1]).toBeGreaterThan(stats.perLevel[0] as number);
    crowd.dispose();
  });

  it("spends a tight budget on the coarsest level, and draws nothing out of view", () => {
    const crowd = new MiniatureCrowd(archetypes(), { maxFigures: 600, triangleBudget: 1000 });
    crowd.setFigures(table());
    const camera = overTable();
    expect(crowd.update(camera, 0, 1080).perLevel[0]).toBe(0);
    camera.lookAt(0, 60, 200);
    const away = crowd.update(camera, 0, 1080);
    expect(away).toEqual({ visible: 0, perLevel: [0, 0], triangles: 0, drawCalls: 0 });
    crowd.dispose();
  });

  it("refuses a crowd it cannot draw", () => {
    const [a, b] = archetypes() as [MiniatureBake, MiniatureBake];
    expect(() => new MiniatureCrowd([])).toThrow(RangeError);
    expect(() => new MiniatureCrowd([a, { ...b, lods: b.lods.slice(0, 1) }])).toThrow(/levels/);
    expect(() => new MiniatureCrowd([a], { levelPixels: [64] })).toThrow(/levelPixels/);
    const crowd = new MiniatureCrowd([a], { maxFigures: 2 });
    expect(() => crowd.setFigures(table().slice(0, 3))).toThrow(/holds 2/);
    expect(() => crowd.setFigures([{ archetype: 5, x: 0, z: 0 }])).toThrow(/archetype 5/);
    crowd.dispose();
  });

  it("measures a figure's height on screen", () => {
    const camera = new PerspectiveCamera(90, 1, 0.1, 100);
    // At distance 1 a 90° view is 2 m tall: a 1 m figure fills half of 800 px.
    expect(projectedPixels(camera, 1, 1, 800)).toBeCloseTo(400, 6);
  });
});
