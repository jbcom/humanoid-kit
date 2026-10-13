import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decodeMiniature,
  encodeMiniature,
  fromHalf,
  MiniatureFormatError,
  miniatureTransferables,
  octDecode,
  octEncode,
  toHalf,
} from "../src/bake/format.ts";
import {
  bakeMiniature,
  MINIATURE_LODS,
  type MiniatureBake,
  MiniatureError,
  TINT_CHANNELS,
} from "../src/bake/miniature.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { bodyPoseRotations, rigData } from "../src/rig/pose.ts";
import { linearToSrgb, skinAlbedo } from "../src/surface/skinTone.ts";
import { clip } from "./animationHarness.ts";
import { loadFixtureAssets, loadMiniatureAssets } from "./fixtures.ts";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("baking a miniature", { timeout: 300_000 }, () => {
  const assets = loadMiniatureAssets();
  const model = new HumanoidModel(assets, { subdivision: 0 });
  const rig = rigData(assets);
  const recipe = createRecipe({
    skin: { melanin: 0.6 },
    outfit: ["suits/male_worksuit01", "shoes/shoes01", "hats/fedora01"],
  });
  const pose = bodyPoseRotations(rig, "relaxed");
  let casting: MiniatureBake | undefined;
  const castingOf = () => {
    casting ??= bakeMiniature(model, recipe, { pose });
    return casting;
  };

  it("meets each level's triangle budget over one shared vertex set", () => {
    const bake = castingOf();
    expect(bake.body).toBe("proxy741");
    expect(bake.lods.map((l) => l.target)).toEqual([...MINIATURE_LODS]);
    for (const l of bake.lods) {
      expect(l.index.length / 3).toBeLessThanOrEqual(l.target);
      expect(l.index.length / 3).toBeGreaterThan(l.target * 0.95);
      for (const v of l.index) expect(v).toBeLessThan(bake.vertexCount);
      expect(l.normals.length).toBe(bake.vertexCount * 3);
    }
    // The near level uses every vertex; the far one a subset of them.
    expect(new Set(bake.lods[0]?.index).size).toBe(bake.vertexCount);
    expect(new Set(bake.lods[1]?.index).size).toBeLessThan(bake.vertexCount / 2);
  });

  it("stands the casting on the ground at the figure's height", () => {
    const bake = castingOf();
    expect(bake.frameCount).toBe(1);
    expect(bake.clips).toEqual([]);
    expect(bake.min[1]).toBeGreaterThanOrEqual(-1e-6);
    expect(bake.min[1]).toBeLessThan(0.01);
    // A man of default height in a fedora.
    expect(bake.max[1]).toBeGreaterThan(1.6);
    expect(bake.max[1]).toBeLessThan(2);
  });

  it("paints skin by the recipe's tone and gives each garment its tint channel", () => {
    const bake = castingOf();
    const skin = skinAlbedo(recipe.skin).map(linearToSrgb);
    const channels = new Set(bake.channel);
    expect([...channels].sort()).toEqual([0, 1, 2, 3]);
    expect(TINT_CHANNELS[3]).toBe("accessory");
    // The face: untinted vertices at the top of the body, coloured as the skin.
    let faces = 0;
    for (let v = 0; v < bake.vertexCount; v++) {
      const y = bake.positions[v * 3 + 1] as number;
      if (bake.channel[v] !== 0 || y < bake.max[1] - 0.3 || y > bake.max[1] - 0.2) continue;
      faces++;
      for (let c = 0; c < 3; c++)
        expect(Math.abs((bake.colour[v * 3 + c] as number) - (skin[c] as number))).toBeLessThan(3);
    }
    expect(faces).toBeGreaterThan(5);
  });

  it("bakes clips as frames, sampled at their rate, in order", () => {
    const walk = clip("walk_loop");
    const idle = clip("idle_loop");
    const bake = bakeMiniature(model, recipe, {
      clips: [
        { name: "walk", clip: walk },
        { name: "idle", clip: idle, fps: 10 },
      ],
      samplePoses: 4,
    });
    expect(bake.clips).toEqual([
      { name: "walk", start: 0, frames: Math.round(walk.duration * 15), fps: 15, loop: true },
      {
        name: "idle",
        start: Math.round(walk.duration * 15),
        frames: Math.round(idle.duration * 10),
        fps: 10,
        loop: true,
      },
    ]);
    expect(bake.frameCount).toBe(Math.round(walk.duration * 15) + Math.round(idle.duration * 10));
    const N = bake.vertexCount;
    expect(bake.positions.length).toBe(bake.frameCount * N * 3);
    // The walk moves the figure: some vertex travels between its first two frames.
    let moved = 0;
    for (let i = 0; i < N * 3; i++)
      moved = Math.max(
        moved,
        Math.abs((bake.positions[N * 3 + i] as number) - (bake.positions[i] as number)),
      );
    expect(moved).toBeGreaterThan(0.01);
  });

  it("refuses what it cannot bake", () => {
    const adult = new HumanoidModel(loadFixtureAssets(true), { subdivision: 0 });
    expect(() => bakeMiniature(adult, createRecipe({}))).toThrow(MiniatureError);
    expect(() => bakeMiniature(model, recipe, { lods: [] })).toThrow(/level of detail/);
    expect(() => bakeMiniature(model, recipe, { lods: [400, 1500] })).toThrow(MiniatureError);
    expect(() => bakeMiniature(model, recipe, { lods: [0] })).toThrow(MiniatureError);
    const walk = { name: "walk", clip: clip("walk_loop") };
    expect(() => bakeMiniature(model, recipe, { pose, clips: [walk] })).toThrow(/not both/);
    expect(() => bakeMiniature(model, recipe, { clips: [walk, walk] })).toThrow(/twice/);
    expect(() => bakeMiniature(model, recipe, { clips: [{ ...walk, fps: 0 }] })).toThrow(/fps/);
  });

  it("encodes to the same bytes every time, and decodes to the bake within its quantization", () => {
    const bake = castingOf();
    const a = encodeMiniature(bake);
    const again = encodeMiniature(bakeMiniature(model, recipe, { pose }));
    expect(sha(again)).toBe(sha(a));
    const back = decodeMiniature(a.buffer.slice(0) as ArrayBuffer);
    expect(back.vertexCount).toBe(bake.vertexCount);
    expect(back.colour).toEqual(bake.colour);
    expect(back.channel).toEqual(bake.channel);
    expect(back.lods.map((l) => [...l.index])).toEqual(bake.lods.map((l) => [...l.index]));
    for (let i = 0; i < bake.positions.length; i++)
      expect(Math.abs((back.positions[i] as number) - (bake.positions[i] as number))).toBeLessThan(
        1e-3,
      );
    const n0 = bake.lods[0]?.normals as Float32Array;
    const n1 = back.lods[0]?.normals as Float32Array;
    for (let i = 0; i < n0.length; i++)
      expect(Math.abs((n1[i] as number) - (n0[i] as number))).toBeLessThan(0.03);
    expect(miniatureTransferables(back).length).toBe(3 + 2 * back.lods.length);
  });

  it("refuses bytes that are not a bake of this format", () => {
    const bytes = encodeMiniature(castingOf());
    expect(() => decodeMiniature(new Uint8Array(8))).toThrow(MiniatureFormatError);
    const future = bytes.slice();
    future[4] = 9;
    expect(() => decodeMiniature(future)).toThrow(/format 9/);
    expect(() => decodeMiniature(bytes.subarray(0, 64))).toThrow(MiniatureFormatError);
    // A header whose clip runs past its frames.
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const length = view.getUint32(8, true);
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + length)));
    header.clips = [{ name: "walk", start: 0, frames: 2, fps: 15, loop: true }];
    const json = new TextEncoder().encode(JSON.stringify(header));
    const start = Math.ceil((12 + length) / 4) * 4;
    const forged = new Uint8Array(Math.ceil((12 + json.length) / 4) * 4 + bytes.length - start);
    forged.set(bytes.subarray(0, 12));
    new DataView(forged.buffer).setUint32(8, json.length, true);
    forged.set(json, 12);
    forged.set(bytes.subarray(start), Math.ceil((12 + json.length) / 4) * 4);
    expect(() => decodeMiniature(forged)).toThrow(/runs past/);
  });
});

describe("the miniature binary's number formats", () => {
  it("rounds to half precision and back", () => {
    for (const [x, h] of [
      [0, 0],
      [1, 0x3c00],
      [-2, 0xc000],
      [65504, 0x7bff],
      [1e6, 0x7c00],
      [2 ** -24, 1],
      [1e-9, 0],
    ] as const)
      expect(toHalf(x)).toBe(h);
    expect(fromHalf(0x7c00)).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(fromHalf(0x7e00))).toBe(true);
    expect(toHalf(Number.NaN) & 0x7c00).toBe(0x7c00);
    for (const x of [0.001, 0.3333, 1.684, -0.52])
      expect(Math.abs(fromHalf(toHalf(x)) - x)).toBeLessThan(1e-3);
  });

  it("packs a unit normal into two signed bytes within a degree and a half", () => {
    for (const n of [
      [0, 1, 0],
      [0, 0, -1],
      [0.6, -0.48, 0.64],
      [-0.577, 0.577, -0.577],
    ] as const) {
      const l = Math.hypot(...n);
      const [x, y, z] = octDecode(...octEncode(n[0] / l, n[1] / l, n[2] / l));
      expect((x * n[0] + y * n[1] + z * n[2]) / l).toBeGreaterThan(Math.cos((1.5 * Math.PI) / 180));
    }
  });
});
