/**
 * A real WebGL receipt for #118's generated inner-vulva coordinate. The source
 * pack supplies the maximum coordinate; SkinMaterial then reads it from its
 * field atlas and interpolates VULVA_LAYER's two painted stops on the GPU.
 */

import { describe, expect, it } from "vitest";
import adultManifest from "../../packs/adult-anatomy/data/manifest.json";
import { VULVA_LAYER } from "../../src/surface/regions/adult.ts";
import { renderLayersRgba, SIZE } from "./layerRender.ts";

const appearance = (arousal: number) => ({
  tone: { melanin: 0.5, haemoglobin: 0.5, undertone: 0, override: null },
  flush: 0,
  lips: 0.5,
  areola: 0.5,
  signals: { arousal },
  adult: true,
  anatomy: { vulva: 1 },
});

const vulva = adultManifest.anatomy?.skinLayers.find((layer) => layer.id === "vulva-skin");
if (!vulva?.vertexCoord) throw new Error("the generated adult pack has no inner-vulva coordinate");
const innerCoord = Math.max(...vulva.vertexCoord.values);

/** The centre pixel's RGB from a physical SkinMaterial draw. */
function pixel(coordinate: number, arousal: number) {
  const rgba = renderLayersRgba([VULVA_LAYER], {
    appearance: appearance(arousal),
    coordinate: () => coordinate,
  });
  const i = ((SIZE >> 1) * SIZE + (SIZE >> 1)) * 4;
  return [rgba[i] as number, rgba[i + 1] as number, rgba[i + 2] as number] as const;
}

const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(...a.map((value, i) => value - (b[i] as number)));

describe("the generated inner-vulva coordinate in SkinMaterial", () => {
  it("changes the actual GPU pixel at the pack's inner coordinate, including under arousal", () => {
    expect(innerCoord).toBeGreaterThan(0.9);
    const outerRest = pixel(0, 0);
    const innerRest = pixel(innerCoord, 0);
    const outerAroused = pixel(0, 1);
    const innerAroused = pixel(innerCoord, 1);
    const innerAtRest = distance(outerRest, innerRest);
    const innerAtArousal = distance(outerAroused, innerAroused);
    const arousalAtInner = distance(innerRest, innerAroused);
    console.log(
      `#118 GPU vulva receipt ${JSON.stringify({ innerCoord, outerRest, innerRest, outerAroused, innerAroused, innerAtRest, innerAtArousal, arousalAtInner })}`,
    );
    expect(innerAtRest).toBeGreaterThan(0.015);
    expect(innerAtArousal).toBeGreaterThan(0.015);
    expect(arousalAtInner).toBeGreaterThan(0.007);
  });
});
