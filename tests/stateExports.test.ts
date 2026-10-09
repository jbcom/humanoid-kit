import { describe, expect, it } from "vitest";
import * as kit from "../src/index.ts";

describe("the package entry's skin-state API", () => {
  it("exposes the state layers, their zones and constants, the morphs and the time filter", () => {
    const functions = [
      "skinZones",
      "zoneOfBone",
      "buildBoneField",
      "wetness",
      "haemoglobinRatio",
      "lipStateAlbedo",
      "stepSkinState",
      "SkinStateFilter",
      "stateContributions",
      "quantiseShapeSignal",
    ];
    for (const name of functions)
      expect(typeof (kit as Record<string, unknown>)[name], name).toBe("function");
    const objects = [
      "GOOSEBUMP_LAYER",
      "BLUSH_LAYER",
      "EXERTION_FLUSH_LAYER",
      "HEAT_FLUSH_LAYER",
      "FEAR_PALLOR_LAYER",
      "COLD_PALLOR_LAYER",
      "LIP_STATE_LAYER",
      "SWEAT_REST_LAYER",
      "SWEAT_EXERCISE_LAYER",
      "FLUSH_DELTA",
      "SWEAT_RATE",
      "SKIN_ZONES",
      "STATE_MORPHS",
      "STATE_TIME_CONSTANTS",
    ];
    for (const name of objects)
      expect(typeof (kit as Record<string, unknown>)[name], name).toBe("object");
    for (const name of [
      "GOOSEBUMP_HEIGHT",
      "GOOSEBUMP_DENSITY_PER_CM2",
      "SWEAT_ROUGHNESS",
      "SWEAT_SPECULAR",
    ])
      expect(typeof (kit as Record<string, unknown>)[name], name).toBe("number");
  });

  it("lists the state layers in the stack after the rest layers", () => {
    const ids = kit.SKIN_LAYERS.map((l) => l.id);
    expect(ids.slice(0, 3)).toEqual(["flush", "lips", "areola"]);
    expect(ids.slice(3)).toEqual([
      "goosebumps",
      "heat-flush",
      "exertion-flush",
      "blush",
      "cold-pallor",
      "fear-pallor",
      "lips-state",
      "sweat-heat",
      "sweat-exertion",
    ]);
  });
});
