import { createHash } from "node:crypto";
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
import {
  agedHairColour,
  DEFAULT_HAIR_COLOUR,
  HAIR_COLOURS,
  type HairColour,
  hairTint,
} from "../src/surface/hairTone.ts";
import { hairDir, loadHairFixtureAssets } from "./hairFixtures.ts";

const ID = "beard-viking";
const model = new HumanoidModel(loadHairFixtureAssets(), { subdivision: 0 });
const recipe = createRecipe({ hair: { style: null }, facialHair: [ID] });
let source: DecodedTexture;
const sources = new Map<string, DecodedTexture>();

beforeAll(async () => {
  for (const id of [ID, "moustache-viking"]) {
    const decoded = await sharp(path.join(hairDir, `${id}.webp`))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    sources.set(id, { width: decoded.info.width, height: decoded.info.height, data: decoded.data });
  }
  source = sources.get(ID) as DecodedTexture;
});

const sourceTexture = (part: { id: string }) => sources.get(part.id) ?? null;

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

  it("changes only the selected facial tint and restores exact legacy miniature bytes", () => {
    const nativeRecipe = createRecipe({
      hair: { style: null, colour: HAIR_COLOURS.black as HairColour },
      facialHair: [ID, "moustache-viking"],
    });
    const options = {
      body: "surface" as const,
      lods: [400],
      facialHair: "alpha-cards" as const,
      texture: sourceTexture,
    };
    const native = bakeMiniature(model, nativeRecipe, options);
    console.info(
      "default-facial-colour-miniature-sha256",
      createHash("sha256").update(encodeMiniature(native)).digest("hex"),
    );
    const independentRecipe = createRecipe({
      ...nativeRecipe,
      facialHairColour: {
        [ID]: HAIR_COLOURS.white as HairColour,
        "moustache-viking": HAIR_COLOURS.red as HairColour,
      },
    });
    const independent = bakeMiniature(model, independentRecipe, options);
    for (const [i, card] of (independent.alphaCards ?? []).entries()) {
      const nativeCard = native.alphaCards?.[i];
      expect({ ...card, tint: nativeCard?.tint }).toEqual(nativeCard);
      expect(card.tint).toEqual(
        hairTint(
          agedHairColour(
            independentRecipe.facialHairColour?.[card.id] as HairColour,
            nativeRecipe.macros.age,
            "scalp",
          ),
        ),
      );
      expect(card.tint).not.toEqual(nativeCard?.tint);
    }
    expect({ ...independent, alphaCards: native.alphaCards }).toEqual(native);
    const changedRecipe = createRecipe({
      ...independentRecipe,
      facialHairColour: {
        ...independentRecipe.facialHairColour,
        [ID]: HAIR_COLOURS.black as HairColour,
      },
    });
    const changed = bakeMiniature(model, changedRecipe, options);
    expect(changed.alphaCards?.[1]).toEqual(independent.alphaCards?.[1]);
    const compatible = bakeMiniature(
      model,
      createRecipe({ ...nativeRecipe, facialHairColour: {} }),
      options,
    );
    expect(encodeMiniature(compatible)).toEqual(encodeMiniature(native));
    expect(decodeMiniature(encodeMiniature(independent)).alphaCards).toEqual(
      independent.alphaCards,
    );
  });

  it("preserves native source data and legacy bytes beside an independent caller grey field", () => {
    const selected = createRecipe({ facialHair: [ID, "moustache-viking"] });
    const options = {
      body: "surface" as const,
      lods: [400],
      facialHair: "alpha-cards" as const,
      texture: sourceTexture,
    };
    const native = bakeMiniature(model, selected, options);
    const sourceSha256 = model.assets.hair?.styles.get(ID)?.sha256;
    if (!sourceSha256) throw new Error("source style missing");
    const registry = {
      streak: { sourceSha256, width: 2, height: 2, data: new Uint8Array([0, 128, 255, 0]) },
    };
    const maskedRecipe = createRecipe({
      ...selected,
      facialHairGrey: { [ID]: { mask: "streak", amount: 0.5 } },
    });
    expect(() => bakeMiniature(model, maskedRecipe, options)).toThrow(/mask.*streak.*missing/);
    const masked = bakeMiniature(model, maskedRecipe, {
      ...options,
      facialHairGreyMasks: registry,
    });
    const card = masked.alphaCards?.[0];
    expect(card?.grey?.data).toEqual(registry.streak.data);
    expect(card?.grey?.data.buffer).not.toBe(registry.streak.data.buffer);
    expect({ ...card, grey: undefined }).toEqual({ ...native.alphaCards?.[0], grey: undefined });
    expect(masked.alphaCards?.[1]).toEqual(native.alphaCards?.[1]);
    expect({ ...masked, alphaCards: native.alphaCards }).toEqual(native);
    const encoded = encodeMiniature(masked);
    expect(decodeMiniature(encoded).alphaCards).toEqual(masked.alphaCards);
    expect(registry.streak.data).toEqual(new Uint8Array([0, 128, 255, 0]));
    const zero = createRecipe({
      ...selected,
      facialHairGrey: { [ID]: { mask: "streak", amount: 0 } },
    });
    expect(
      encodeMiniature(bakeMiniature(model, zero, { ...options, facialHairGreyMasks: registry })),
    ).toEqual(encodeMiniature(native));
    const tags = model.assets.hair?.styles.get(ID)?.tags;
    const entry = model.assets.hair?.styles.get(ID);
    if (!entry || !tags) throw new Error("source entry missing");
    try {
      entry.tags = [];
      expect(() => model.evaluate(maskedRecipe)).toThrow(/not a beard or moustache/);
    } finally {
      entry.tags = tags;
    }
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
