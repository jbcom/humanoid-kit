/**
 * Issue #21's renderer-response probe. It deliberately stops before WebGL: the
 * next root-reviewed sheet decides whether these source-side facts need a
 * renderer change. It records the exact paint uniforms, adult-surface masks
 * and triangle counts the renderer receives, plus the shader's current alpha
 * and projected-footprint math.
 */
import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import {
  COAT_FOLLICLE_CELL_METRES,
  COAT_NORMALIZED_RADIUS,
  CoatMaterial,
} from "../src/render/coat.ts";
import { bodyHairFollicleDensity } from "../src/surface/bodyHair.ts";
import { coatTriangles } from "../src/surface/coat.ts";
import { coatPaintFor } from "../src/surface/coatPaint.ts";
import { BODY_HAIR_COAT } from "../src/surface/regions/bodyHairCoat.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const GROUPS = [
  ["face", ["beard-moustache", "beard-chin", "beard-cheeks"]],
  ["chest", ["hair-chest"]],
  ["axillary", ["hair-axillary"]],
  ["pubic", ["hair-pubic"]],
] as const;
const COVERAGES = [0.1, 0.25, 0.5, 0.75, 0.85, 0.95, 1] as const;
const DENSITIES = [1, 2] as const;

const regionIndex = (id: string) => {
  const index = BODY_HAIR_COAT.findIndex((region) => region.id === id);
  if (index < 0) throw new Error(`no coat region ${id}`);
  return index;
};

const hair = (coverage: number, follicleDensity: number) => ({
  coverage: { face: coverage, chest: coverage, axillary: coverage, pubic: coverage },
  follicleDensity: {
    face: follicleDensity,
    chest: follicleDensity,
    axillary: follicleDensity,
    pubic: follicleDensity,
  },
  beard: "full" as const,
});

const recipe = (coverage: number, follicleDensity: number) =>
  createRecipe({
    macros: { age: 35, gender: 0.5 },
    bodyHair: hair(coverage, follicleDensity),
  });

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};

/** The current GLSL's per-region math, in its own normalized follicle-cell space. */
function shaderResponse(
  density: number,
  width: number,
  length: number,
  lie: number,
  cover: number,
  cellsPerPixel: number,
  viewTangent = 0,
  shells = 8,
) {
  const spacing = COAT_FOLLICLE_CELL_METRES / Math.sqrt(density);
  const rawRadius = (COAT_NORMALIZED_RADIUS.factor * width) / spacing;
  const radius = clamp(rawRadius, COAT_NORMALIZED_RADIUS.min, COAT_NORMALIZED_RADIUS.max);
  const height = (0.8 * length * (1 - 0.7 * lie)) / spacing;
  const bases = Math.min(0.95, cover * Math.PI * radius * radius);
  const sides = cover * 2 * 0.6 * radius * height * viewTangent;
  const combinedAlpha = 1 - (1 - bases) * Math.exp(-sides);
  const perShellAlpha = 1 - (1 - bases) ** (1 / shells) * Math.exp(-sides / shells);
  return {
    spacing,
    rawRadius,
    radius,
    height,
    combinedAlpha,
    perShellAlpha,
    resolvedWeight: smoothstep(0.5, 1.5, (2 * radius) / cellsPerPixel),
  };
}

describe("Issue #21 coat response probe", () => {
  const assets = loadFixtureAssets(true);
  const model = new HumanoidModel(assets, { subdivision: 1 });
  const responseRecipe = recipe(0.75, 1);
  model.evaluate(responseRecipe);
  const surface = model.adultSurface();
  if (!surface) throw new Error("adult response probe needs the adult surface");

  it("delivers every explicit coverage and physical-density pair into coat uniforms", () => {
    for (const coverage of COVERAGES)
      for (const follicleDensity of DENSITIES) {
        const input = recipe(coverage, follicleDensity);
        const table = coatPaintFor(input);
        expect(table, `cover ${coverage}, density ${follicleDensity}`).not.toBeNull();
        const material = new CoatMaterial();
        material.setPaint(table as Float32Array);
        for (const [group, ids] of GROUPS) {
          const expectedDensity = bodyHairFollicleDensity(group, {
            age: 35,
            gender: 0.5,
            colour: input.hair?.colour ?? {
              eumelanin: 0.5,
              pheomelanin: 0.1,
              grey: 0,
              override: null,
            },
            ...(input.bodyHair && { bodyHair: input.bodyHair }),
          });
          for (const id of ids) {
            const uniform = material.hkUniforms.hkCoatPaint.value[regionIndex(id) * 2];
            expect(uniform?.x, `${group} ${coverage}/${follicleDensity} cover`).toBeCloseTo(
              coverage,
            );
            expect(uniform?.z, `${group} ${coverage}/${follicleDensity} follicles`).toBeCloseTo(
              expectedDensity,
            );
          }
        }
        material.dispose();
      }
  });

  it("carries measured masks and painted index counts for every requested group", () => {
    const table = coatPaintFor(responseRecipe) as Float32Array;
    const report = GROUPS.map(([group, ids]) => {
      const indices = ids.map(regionIndex);
      let maskedVertices = 0;
      let weightedMask = 0;
      for (let v = 0; v < surface.coat.masks.length / BODY_HAIR_COAT.length; v++)
        for (const index of indices) {
          const mask = surface.coat.masks[v * BODY_HAIR_COAT.length + index] as number;
          weightedMask += mask / 255;
          if (mask > 0) {
            maskedVertices++;
            break;
          }
        }
      const groupTable = new Float32Array(table.length);
      for (const index of indices) groupTable.set(table.slice(index * 8, index * 8 + 8), index * 8);
      const paintedIndices = coatTriangles(surface.index, surface.coat.masks, groupTable);
      const vertexCount = surface.coat.masks.length / BODY_HAIR_COAT.length;
      return {
        group,
        maskedVertices,
        meanMask: weightedMask / vertexCount,
        paintedIndices: paintedIndices.length,
      };
    });
    for (const item of report) expect(item.maskedVertices, item.group).toBeGreaterThan(0);
    for (const item of report) expect(item.paintedIndices, item.group).toBeGreaterThan(0);
    console.log(`Issue #21 coat masks/indices: ${JSON.stringify({ report })}`);
  });

  it("keeps chest follicle density visibly responsive instead of pinning it to a radius floor", () => {
    const chest = BODY_HAIR_COAT[regionIndex("hair-chest")];
    if (!chest) throw new Error("no chest coat region");
    const paint = chest.paint({
      tone: { melanin: 0.5, haemoglobin: 0.5, undertone: 0, override: null },
      flush: 0.45,
      lips: 0.55,
      areola: 0.5,
      signals: {},
      age: 35,
      gender: 0.5,
      adult: true,
      bodyHair: hair(0.75, 1),
    });
    const one = shaderResponse(paint.density, paint.width, paint.length, paint.lie, paint.cover, 1);
    const two = shaderResponse(
      paint.density * 2,
      paint.width,
      paint.length,
      paint.lie,
      paint.cover,
      1,
    );
    expect(one.radius).toBeCloseTo(one.rawRadius, 6);
    expect(two.radius).toBeCloseTo(two.rawRadius, 6);
    expect(two.radius).toBeGreaterThan(one.radius);
    expect(two.combinedAlpha).toBeGreaterThan(one.combinedAlpha * 1.8);
  });

  it("keeps normal-view shell accumulation low even for the broad pubic mask", () => {
    const pubic = BODY_HAIR_COAT[regionIndex("hair-pubic")];
    if (!pubic) throw new Error("no pubic coat region");
    const paint = pubic.paint({
      tone: { melanin: 0.5, haemoglobin: 0.5, undertone: 0, override: null },
      flush: 0.45,
      lips: 0.55,
      areola: 0.5,
      signals: {},
      age: 35,
      gender: 0.5,
      adult: true,
      bodyHair: hair(0.1, 1),
    });
    const response = shaderResponse(
      paint.density,
      paint.width,
      paint.length,
      paint.lie,
      paint.cover,
      1,
    );
    expect(response.combinedAlpha).toBeLessThan(0.01);
    expect(1 - (1 - response.perShellAlpha) ** 8).toBeCloseTo(response.combinedAlpha, 8);
  });
});
