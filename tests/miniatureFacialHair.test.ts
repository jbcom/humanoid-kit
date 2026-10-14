import path from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { figureAtRest } from "../src/bake/figure.ts";
import {
  decodeMiniature,
  encodeMiniature,
  MiniatureFormatError,
  miniatureTransferables,
} from "../src/bake/format.ts";
import { bakeMiniature, type DecodedTexture, MiniatureError } from "../src/bake/miniature.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { agedHairColour, DEFAULT_HAIR_COLOUR, hairTint } from "../src/surface/hairTone.ts";
import { hairDir, loadHairFixtureAssets } from "./hairFixtures.ts";

const ID = "beard-viking";
const model = new HumanoidModel(loadHairFixtureAssets(), { subdivision: 0 });
const recipe = createRecipe({ hair: { style: null }, facialHair: [ID] });
let source: DecodedTexture;

beforeAll(async () => {
  const decoded = await sharp(path.join(hairDir, `${ID}.webp`))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  source = { width: decoded.info.width, height: decoded.info.height, data: decoded.data };
});

const sourceTexture = () => source;

describe("facial source cards in miniature bakes", { timeout: 120_000 }, () => {
  it("keeps figure cards opt-in and preserves their source topology and UV seams", () => {
    const ordinary = figureAtRest(model, recipe);
    expect(ordinary.parts.some((part) => part.role === "facialHair")).toBe(false);
    const figure = figureAtRest(model, recipe, { facialHair: true });
    const part = figure.parts.find((candidate) => candidate.role === "facialHair");
    const topology = model.hairTopology(ID);
    expect(part?.id).toBe(ID);
    expect(part?.index).toEqual(topology.index);
    expect(part?.uvs).toEqual(topology.uvs);
  });

  it("requires an RGBA source texture only when alpha-card preservation is requested", () => {
    expect(
      bakeMiniature(model, recipe, { body: "surface", lods: [400] }).alphaCards,
    ).toBeUndefined();
    expect(() =>
      bakeMiniature(model, recipe, { body: "surface", lods: [400], facialHair: "alpha-cards" }),
    ).toThrow(MiniatureError);
  });

  it("carries exact selected source cards and their animated frames outside opaque decimation", () => {
    const bake = bakeMiniature(model, recipe, {
      body: "surface",
      lods: [400],
      facialHair: "alpha-cards",
      texture: sourceTexture,
    });
    const card = bake.alphaCards?.[0];
    const topology = model.hairTopology(ID);
    expect(card?.id).toBe(ID);
    expect(card?.vertexCount).toBe(topology.vertexCount);
    expect(card?.index).toEqual(topology.index);
    expect(card?.uvs).toEqual(topology.uvs);
    expect(card?.positions.length).toBe(bake.frameCount * topology.vertexCount * 3);
    expect(card?.normals.length).toBe(bake.frameCount * topology.vertexCount * 3);
    expect(card?.texture).toEqual({
      width: source.width,
      height: source.height,
      rgba: Uint8Array.from(source.data),
    });
    expect(card?.tint).toEqual(
      hairTint(
        agedHairColour(recipe.hair?.colour ?? DEFAULT_HAIR_COLOUR, recipe.macros.age, "scalp"),
      ),
    );
  });

  it("round-trips alpha cards in v2 and continues to read an equivalent v1 opaque bake", () => {
    const cards = bakeMiniature(model, recipe, {
      body: "surface",
      lods: [400],
      facialHair: "alpha-cards",
      texture: sourceTexture,
    });
    const restored = decodeMiniature(encodeMiniature(cards));
    expect(restored.alphaCards).toEqual(cards.alphaCards);
    const card = cards.alphaCards?.[0];
    if (!card) throw new Error("expected the selected source card");
    const transferables = miniatureTransferables(cards);
    expect(transferables).toEqual(
      expect.arrayContaining([
        card.index.buffer,
        card.uvs.buffer,
        card.positions.buffer,
        card.normals.buffer,
        card.texture.rgba.buffer,
      ]),
    );

    const opaque = encodeMiniature(bakeMiniature(model, recipe, { body: "surface", lods: [400] }));
    const v1 = opaque.slice();
    new DataView(v1.buffer, v1.byteOffset, v1.byteLength).setUint32(4, 1, true);
    expect(decodeMiniature(v1).alphaCards).toBeUndefined();
  });

  it("rejects a v2 alpha-card header that is not a list", () => {
    const header = new TextEncoder().encode('{"alphaCards":{}}');
    const bytes = new Uint8Array(12 + header.byteLength);
    bytes.set([0x48, 0x4b, 0x4d, 0x42]);
    const view = new DataView(bytes.buffer);
    view.setUint32(4, 2, true);
    view.setUint32(8, header.byteLength, true);
    bytes.set(header, 12);
    expect(() => decodeMiniature(bytes)).toThrow(MiniatureFormatError);
  });
});
