import { describe, expect, it } from "vitest";
import { createRecipe, type Recipe } from "../src/recipe/recipe.ts";
import { recipeProblems } from "../src/recipe/validate.ts";

const ID = "beard-viking";

describe("facial UV greying recipe contract", () => {
  it("retains independent mask requests in plain JSON without aliasing input", () => {
    const request = { [ID]: { mask: "caller-streak", amount: 0.5 } };
    const input = { facialHair: [ID], facialHairGrey: request };
    const recipe = createRecipe(input);
    request[ID].amount = 0;
    expect(recipe).toHaveProperty("facialHairGrey", {
      [ID]: { mask: "caller-streak", amount: 0.5 },
    });
    expect(createRecipe(JSON.parse(JSON.stringify(recipe)))).toEqual(recipe);
    expect(structuredClone(recipe)).toEqual(recipe);
    expect(createRecipe()).not.toHaveProperty("facialHairGrey");
  });

  it.each([
    null,
    [],
    "mask",
    { [ID]: null },
    { [ID]: { mask: "", amount: 0.5 } },
    { [ID]: { mask: "streak", amount: -1 } },
    { [ID]: { mask: "streak", amount: 2 } },
    { [ID]: { mask: "streak", amount: Number.NaN } },
    { [ID]: { mask: "streak" } },
    { other: { mask: "streak", amount: 1 } },
  ])("rejects an invalid or unselected mask request: %j", (facialHairGrey) => {
    const recipe = { ...createRecipe({ facialHair: [ID] }), facialHairGrey } as unknown as Recipe;
    expect(recipeProblems(recipe).length).toBeGreaterThan(0);
  });
});

// A caller-authored field and a tiny retained-card payload exercise the public
// transport contract, not the visual suitability of any packaged style.
import { decodeMiniature, encodeMiniature, miniatureTransferables } from "../src/bake/format.ts";
import type { MiniatureBake } from "../src/bake/miniature.ts";
import { facialHairColour } from "../src/recipe/facialHairColour.ts";
import {
  assertFacialHairGreyMask,
  type FacialHairGreyMasks,
  facialHairGreyTint,
  resolveFacialHairGrey,
} from "../src/surface/facialHairGrey.ts";
import { hairTint } from "../src/surface/hairTone.ts";

const SHA = "a".repeat(64);
const masks = (): FacialHairGreyMasks => ({
  streak: { sourceSha256: SHA, width: 2, height: 2, data: new Uint8Array([0, 128, 255, 0]) },
});
const greyRecipe = () =>
  createRecipe({
    macros: { age: 20 },
    facialHair: [ID, "moustache-viking"],
    facialHairGrey: { [ID]: { mask: "streak", amount: 0.5 } },
  });
function tinyBake(): MiniatureBake {
  return {
    body: "surface",
    vertexCount: 3,
    frameCount: 1,
    colour: new Uint8Array(9),
    channel: new Uint8Array(3),
    positions: new Float32Array(9),
    clips: [],
    min: [0, 0, 0],
    max: [1, 1, 1],
    lods: [
      {
        target: 1,
        index: new Uint32Array([0, 1, 2]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      },
    ],
    alphaCards: [
      {
        id: ID,
        vertexCount: 3,
        index: new Uint32Array([0, 1, 2]),
        positions: new Float32Array(9),
        normals: new Float32Array(9),
        uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
        texture: { width: 1, height: 1, rgba: new Uint8Array([128, 128, 128, 255]) },
        tint: [0.1, 0.2, 0.3],
      },
    ],
  };
}

describe("resolved facial greying", () => {
  it("keeps per-style absence, zero amount and zero masks exact", () => {
    expect(resolveFacialHairGrey(greyRecipe(), "moustache-viking", SHA)).toBeNull();
    const recipe = greyRecipe();
    recipe.facialHairGrey = { [ID]: { mask: "streak", amount: 0 } };
    expect(resolveFacialHairGrey(recipe, ID, SHA, masks())).toBeNull();
    const blank = masks();
    blank.streak?.data.fill(0);
    expect(resolveFacialHairGrey(greyRecipe(), ID, SHA, blank)).toBeNull();
  });
  it("requires a valid mask even when its amount is zero", () => {
    const recipe = greyRecipe();
    recipe.facialHairGrey = { [ID]: { mask: "streak", amount: 0 } };
    expect(() => resolveFacialHairGrey(recipe, ID, SHA)).toThrow(/beard-viking.*streak.*missing/);
  });
  it("pins the style and preserves typed-array views and structured cloning", () => {
    const registry = masks();
    const field = resolveFacialHairGrey(greyRecipe(), ID, SHA, structuredClone(registry));
    expect(field?.data).toEqual(new Uint8Array([0, 128, 255, 0]));
    expect(field?.tint).toEqual([1.375, 1.375, 1.375]);
    expect(() => resolveFacialHairGrey(greyRecipe(), ID, "b".repeat(64), registry)).toThrow(
      /checksum/,
    );
  });
  it.each([
    { width: 0 },
    { height: -1 },
    { width: 1.5 },
    { width: Number.MAX_SAFE_INTEGER },
    { width: 2, height: Number.MAX_SAFE_INTEGER },
    { data: new Float32Array(4) },
    { data: new Uint8Array(3) },
    { sourceSha256: "wrong" },
  ])("rejects malformed mask addressing or storage: %j", (change) => {
    expect(() => assertFacialHairGreyMask({ ...masks().streak, ...change })).toThrow();
  });
  it("does not invent a core texture-size cap", () => {
    const data = new Uint8Array(4096);
    expect(() =>
      assertFacialHairGreyMask({ sourceSha256: SHA, width: 4096, height: 1, data }),
    ).not.toThrow();
  });
  it("blends dyed black without division and preserves the scalar-grey and age floor", () => {
    const white: [number, number, number] = [1.375, 1.375, 1.375];
    expect(facialHairGreyTint([0, 0, 0], white, 1, 1)).toEqual(white);
    expect(facialHairGreyTint([0, 0.5, 1], white, 0.5, 0.5)).toEqual([0.34375, 0.71875, 1.09375]);
    for (const age of [20, 75]) {
      const recipe = createRecipe({
        ...greyRecipe(),
        macros: { age },
        facialHairColour: {
          [ID]: { eumelanin: 0.5, pheomelanin: 0.1, grey: 0.25, override: null },
        },
      });
      const base = hairTint(facialHairColour(recipe, ID));
      expect(facialHairGreyTint(base, white, 1, 0)).toEqual(base);
      const local = facialHairGreyTint(base, white, 0.5, 1);
      expect(local[0]).toBeCloseTo((base[0] + 1.375) / 2, 12);
      expect(facialHairColour(recipe, ID).grey).toBeGreaterThanOrEqual(0.25);
    }
  });
});

describe("optional mask transport in miniature binaries", () => {
  it("requires v3 for a mask and retains the full field through decode and transfer", () => {
    const bake = tinyBake();
    const card = bake.alphaCards?.[0];
    if (!card) throw new Error("card missing");
    const resolved = resolveFacialHairGrey(greyRecipe(), ID, SHA, masks());
    if (!resolved) throw new Error("field missing");
    card.grey = { ...resolved, data: Uint8Array.from(resolved.data) };
    const bytes = encodeMiniature(bake);
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true)).toBe(3);
    expect(decodeMiniature(bytes).alphaCards?.[0]?.grey).toEqual(card.grey);
    expect(miniatureTransferables(bake)).toContain(card.grey.data.buffer);
    const downgraded = bytes.slice();
    new DataView(downgraded.buffer).setUint32(4, 2, true);
    expect(() => decodeMiniature(downgraded)).toThrow(/grey|mask|v3/);
    expect(encodeMiniature(decodeMiniature(bytes))).toEqual(bytes);
  });
  it("keeps ordinary cards in v2 and restores the exact bytes after removing a mask", () => {
    const bake = tinyBake();
    const baseline = encodeMiniature(bake);
    expect(new DataView(baseline.buffer).getUint32(4, true)).toBe(2);
    const card = bake.alphaCards?.[0];
    if (!card) throw new Error("card missing");
    const field = resolveFacialHairGrey(greyRecipe(), ID, SHA, masks());
    if (!field) throw new Error("field missing");
    card.grey = { ...field, data: Uint8Array.from(field.data) };
    delete card.grey;
    expect(encodeMiniature(bake)).toEqual(baseline);
  });
});

import { checkFacialHairGreySize, facialHairGreyTexture } from "../src/render/facialHairGrey.ts";
import { MiniatureCrowd } from "../src/render/miniature.ts";

describe("mask resources and malformed transport", () => {
  it("owns its R8 upload and checks actual renderer limits without resizing", () => {
    const registry = masks();
    const field = resolveFacialHairGrey(greyRecipe(), ID, SHA, registry);
    if (!field) throw new Error("field missing");
    const texture = facialHairGreyTexture(field);
    expect(texture.image.data).toEqual(field.data);
    expect(texture.image.data).not.toBe(field.data);
    expect(texture.flipY).toBe(true);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.unpackAlignment).toBe(1);
    expect(() => checkFacialHairGreySize(field, 1)).toThrow(/renderer/);
    expect(() => checkFacialHairGreySize(field, 2)).not.toThrow();
    texture.dispose();
    expect(registry.streak?.data.byteLength).toBe(4);
  });
  it("counts and disposes the mask separately from the exact source map", () => {
    const plain = tinyBake();
    const masked = tinyBake();
    const field = resolveFacialHairGrey(greyRecipe(), ID, SHA, masks());
    const card = masked.alphaCards?.[0];
    if (!field || !card) throw new Error("field missing");
    card.grey = { ...field, data: Uint8Array.from(field.data) };
    const a = new MiniatureCrowd([plain]);
    const b = new MiniatureCrowd([masked]);
    expect(b.textureBytes - a.textureBytes).toBe(4);
    const source = card.texture.rgba.slice();
    a.dispose();
    b.dispose();
    expect(card.texture.rgba).toEqual(source);
    expect(card.grey.data.byteLength).toBe(4);
  });
  it("transfers only bake-owned mask data, once per underlying buffer", () => {
    const registry = masks();
    const field = resolveFacialHairGrey(greyRecipe(), ID, SHA, registry);
    const bake = tinyBake();
    const card = bake.alphaCards?.[0];
    if (!field || !card) throw new Error("field missing");
    card.grey = { ...field, data: Uint8Array.from(field.data) };
    const transfers = miniatureTransferables(bake);
    expect(transfers.filter((value) => value === card.grey?.data.buffer)).toHaveLength(1);
    const copy = structuredClone(bake, { transfer: transfers });
    expect(card.grey.data.byteLength).toBe(0);
    expect(copy.alphaCards?.[0]?.grey?.data).toEqual(new Uint8Array([0, 128, 255, 0]));
    expect(registry.streak?.data.byteLength).toBe(4);
  });
  it.each([
    (grey: Record<string, unknown>) => {
      grey.amount = 2;
    },
    (grey: Record<string, unknown>) => {
      grey.tint = [1, 2];
    },
    (grey: Record<string, unknown>) => {
      grey.sourceSha256 = "invalid";
    },
    (grey: Record<string, unknown>) => {
      grey.width = 0;
    },
    (grey: Record<string, unknown>) => {
      grey.data = null;
    },
    (grey: Record<string, unknown>) => {
      grey.data = { offset: 0, byteLength: 3 };
    },
    (grey: Record<string, unknown>) => {
      grey.data = { offset: 999999, byteLength: 4 };
    },
  ])("rejects corrupted optional mask fields", (corrupt) => {
    const bake = tinyBake();
    const card = bake.alphaCards?.[0];
    const field = resolveFacialHairGrey(greyRecipe(), ID, SHA, masks());
    if (!card || !field) throw new Error("field missing");
    card.grey = { ...field, data: Uint8Array.from(field.data) };
    const bytes = encodeMiniature(bake);
    const headerLength = new DataView(bytes.buffer).getUint32(8, true);
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headerLength)));
    corrupt(header.alphaCards[0].grey);
    const json = new TextEncoder().encode(JSON.stringify(header));
    const oldStart = Math.ceil((12 + headerLength) / 4) * 4;
    const start = Math.ceil((12 + json.byteLength) / 4) * 4;
    const changed = new Uint8Array(start + bytes.length - oldStart);
    changed.set(bytes.subarray(0, 12));
    new DataView(changed.buffer).setUint32(8, json.length, true);
    changed.set(json, 12);
    changed.set(bytes.subarray(oldStart), start);
    expect(() => decodeMiniature(changed)).toThrow();
  });
});
