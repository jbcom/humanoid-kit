import { describe, expect, it } from "vitest";
import { groupFaces, jointPosition } from "../src/format/assetFormat.ts";
import { labFromLinear } from "../src/surface/cielab.ts";
import {
  applyLayers,
  type ColourLayer,
  paintStopTable,
  type SkinPaintInput,
  STOP_TABLE_WIDTH,
} from "../src/surface/layers.ts";
import { SKIN_LAYERS } from "../src/surface/regions/index.ts";
import { skinZones } from "../src/surface/regions/skinZones.ts";
import {
  BLUSH_LAYER,
  COLD_PALLOR_LAYER,
  EXERTION_FLUSH_LAYER,
  FEAR_PALLOR_LAYER,
  FLUSH_DELTA,
  HEAT_FLUSH_LAYER,
  LIP_STATE_LAYER,
} from "../src/surface/regions/states.ts";
import {
  haemoglobinRatio,
  lipAlbedo,
  lipStateAlbedo,
  type Rgb,
  type SkinTone,
  skinAlbedo,
} from "../src/surface/skinTone.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const tone = (melanin = 0.4): SkinTone => ({
  melanin,
  haemoglobin: 0.5,
  undertone: 0,
  override: null,
});
const input = (
  signals: Record<string, number>,
  over: Partial<SkinPaintInput> = {},
): SkinPaintInput => ({ tone: tone(), flush: 0, lips: 0.5, areola: 0.5, signals, ...over });

const LAYERS: readonly [ColourLayer, string, number][] = [
  [BLUSH_LAYER, "blush", FLUSH_DELTA.blush],
  [EXERTION_FLUSH_LAYER, "exertion", FLUSH_DELTA.exertion],
  [HEAT_FLUSH_LAYER, "heat", FLUSH_DELTA.heat],
  [FEAR_PALLOR_LAYER, "fear", FLUSH_DELTA.fear],
  [COLD_PALLOR_LAYER, "cold", FLUSH_DELTA.cold],
];

describe("flush and pallor move the skin along the haemoglobin axis", () => {
  it("never move the colour further than the whole measured axis, and in the right direction", () => {
    for (const d of Object.values(FLUSH_DELTA)) expect(Math.abs(d)).toBeLessThanOrEqual(1);
    for (const k of ["blush", "exertion", "heat"] as const)
      expect(FLUSH_DELTA[k], k).toBeGreaterThan(0);
    for (const k of ["fear", "cold"] as const) expect(FLUSH_DELTA[k], k).toBeLessThan(0);
  });

  it("multiply by the model's haemoglobin ratio, with the signal as the strength", () => {
    for (const [layer, signal, delta] of LAYERS) {
      expect(layer.blend, layer.id).toBe("multiply");
      expect(layer.paint(input({})).strength, `${layer.id} at rest`).toBe(0);
      for (const s of [0.25, 1]) {
        const p = layer.paint(input({ [signal]: s }));
        expect(p.strength, `${layer.id} at ${s}`).toBeCloseTo(s, 9);
        expect(p.stops, layer.id).toEqual([haemoglobinRatio(tone(), delta)]);
      }
      // Out of range signals are limited, and other signals do nothing.
      expect(layer.paint(input({ [signal]: 4 })).strength).toBe(1);
      expect(layer.paint(input({ [signal]: -1 })).strength).toBe(0);
      const others = Object.fromEntries(
        LAYERS.filter(([, s]) => s !== signal).map(([, s]) => [s, 1]),
      );
      expect(layer.paint(input(others)).strength, `${layer.id} ignores the others`).toBe(0);
    }
  });

  it("leave a colour that is not human skin alone", () => {
    const blue = input(
      { blush: 1, exertion: 1, heat: 1, fear: 1, cold: 1 },
      {
        tone: { melanin: 0.4, haemoglobin: 0.5, undertone: 0, override: [0.1, 0.3, 0.7] },
      },
    );
    for (const [layer] of LAYERS) expect(layer.paint(blue).stops, layer.id).toEqual([[1, 1, 1]]);
  });

  /** What the skin shows with one state layer fully applied: a* against the skin at rest. */
  const shift = (layer: ColourLayer, signal: string, melanin: number) => {
    const t = tone(melanin);
    const table = paintStopTable([layer], input({ [signal]: 1 }, { tone: t }));
    const rest = skinAlbedo(t);
    const state = applyLayers(rest, table, [[1, 0]]);
    return { a: labFromLinear(state)[1] - labFromLinear(rest)[1], state, rest };
  };

  it("redden or blanch by a measurable a*, at the size the delta asks for", () => {
    // The whole axis is about a* 5 on light skin; each state is that fraction of it.
    for (const [layer, signal, delta] of LAYERS) {
      const { a } = shift(layer, signal, 0.1);
      expect(Math.sign(a), layer.id).toBe(Math.sign(delta));
      expect(Math.abs(a), layer.id).toBeGreaterThan(Math.abs(delta) * 5.15 * 0.8);
      expect(Math.abs(a), layer.id).toBeLessThan(Math.abs(delta) * 5.15 * 1.2);
    }
  });

  it("show less on deeper skin, because melanin absorbs what haemoglobin adds", () => {
    for (const [layer, signal] of LAYERS) {
      const light = Math.abs(shift(layer, signal, 0.25).a);
      const deep = Math.abs(shift(layer, signal, 1).a);
      expect(deep, layer.id).toBeLessThan(0.7 * light);
      expect(deep, layer.id).toBeGreaterThan(0.3 * light);
    }
  });

  it("keep the skin's lightness: they change colour, not depth", () => {
    for (const [layer, signal] of LAYERS) {
      const { state, rest } = shift(layer, signal, 0.6);
      expect(labFromLinear(state)[0], layer.id).toBeCloseTo(labFromLinear(rest)[0], 1);
    }
  });
});

describe("lips under cold and fear", () => {
  const t = tone(0.3);
  const lch = (c: Rgb) => {
    const [L, a, b] = labFromLinear(c);
    return { L, C: Math.hypot(a, b), h: (Math.atan2(b, a) * 180) / Math.PI, a, b };
  };

  it("are the resting lips with no cold and no fear, and for a colour that is not skin", () => {
    expect(lipStateAlbedo(t, 0.5, 0, 0)).toEqual(lipAlbedo(t, 0.5));
    const blue = { ...t, override: [0.1, 0.3, 0.7] as Rgb };
    expect(lipStateAlbedo(blue, 0.5, 1, 1)).toEqual(lipAlbedo(blue, 0.5));
  });

  it("turn bluer in the cold: hue toward violet, a little darker and greyer", () => {
    const rest = lch(lipAlbedo(t, 0.5));
    const cold = lch(lipStateAlbedo(t, 0.5, 1, 0));
    expect(cold.h).toBeLessThan(rest.h - 30);
    expect(cold.b).toBeLessThan(rest.b - 8);
    expect(cold.L).toBeLessThan(rest.L);
    expect(cold.C).toBeLessThan(rest.C);
    const half = lch(lipStateAlbedo(t, 0.5, 0.5, 0));
    expect(half.h).toBeLessThan(rest.h);
    expect(half.h).toBeGreaterThan(cold.h);
  });

  it("pale in fright: less chroma, a little lighter, the same hue", () => {
    const rest = lch(lipAlbedo(t, 0.5));
    const fear = lch(lipStateAlbedo(t, 0.5, 0, 1));
    expect(fear.C).toBeLessThan(0.75 * rest.C);
    expect(fear.L).toBeGreaterThan(rest.L);
    expect(fear.h).toBeCloseTo(rest.h, 0);
  });

  it("is a layer over the lips' mask whose strength follows the stronger of the two", () => {
    expect(LIP_STATE_LAYER.blend).toBe("mix");
    expect(LIP_STATE_LAYER.paint(input({})).strength).toBe(0);
    expect(LIP_STATE_LAYER.paint(input({ cold: 0.4 })).strength).toBeCloseTo(0.4, 9);
    expect(LIP_STATE_LAYER.paint(input({ fear: 0.7 })).strength).toBeCloseTo(0.7, 9);
    expect(LIP_STATE_LAYER.paint(input({ cold: 0.4, fear: 0.7 })).strength).toBeCloseTo(0.7, 9);
    expect(LIP_STATE_LAYER.paint(input({ cold: 1 })).stops).toEqual([
      lipStateAlbedo(tone(), 0.5, 1, 0),
    ]);
  });

  it("follow the resting lips in the stack, and every state layer follows the rest layers", () => {
    const at = (l: ColourLayer) => SKIN_LAYERS.indexOf(l);
    expect(at(LIP_STATE_LAYER)).toBeGreaterThan(SKIN_LAYERS.findIndex((l) => l.id === "lips"));
    for (const [layer] of LAYERS)
      expect(at(layer), layer.id).toBeGreaterThan(SKIN_LAYERS.findIndex((l) => l.id === "areola"));
    const table = paintStopTable(SKIN_LAYERS, input({ blush: 1 }));
    expect(table[at(BLUSH_LAYER) * STOP_TABLE_WIDTH * 4]).toBe(1);
    expect(table[at(EXERTION_FLUSH_LAYER) * STOP_TABLE_WIDTH * 4]).toBe(0);
  });
});

describe("where flush and pallor show", () => {
  const assets = loadFixtureAssets();
  const zones = skinZones(assets);
  const P = assets.positions;
  const bones = assets.manifest.skeleton.bones;
  const skin = (() => {
    const out = new Set<number>();
    for (const f of groupFaces(assets, "body"))
      for (let k = 0; k < 4; k++) out.add(assets.faceVerts[f * 4 + k] as number);
    return [...out];
  })();
  const weight = (v: number, re: RegExp) => {
    let s = 0;
    for (let k = 0; k < 4; k++)
      if (re.test(bones[assets.skinIndex[v * 4 + k] as number]?.name ?? ""))
        s += assets.skinWeight[v * 4 + k] as number;
    return s;
  };
  const where = (re: RegExp, min = 0.95) => skin.filter((v) => weight(v, re) >= min);
  const mean = (mask: Float32Array, vs: number[]) =>
    vs.reduce((s, v) => s + (mask[v] as number), 0) / vs.length;
  // Each state layer's mask, by the signal that drives it, and the lips' by its id.
  const masks = Object.fromEntries([
    ...LAYERS.map(([l, signal]) => [signal, l.fields(assets).mask]),
    [LIP_STATE_LAYER.id, LIP_STATE_LAYER.fields(assets).mask],
  ]) as Record<string, Float32Array>;
  const eye = new Float32Array(3);
  jointPosition(assets, assets.positions, "eye.L____head", eye, 0);

  const sample = {
    // Where a cheek is: the cheek-volume target moves it most.
    cheek: (() => {
      const t = assets.targets.get("cheek/l-cheek-volume-incr");
      if (!t) throw new Error("no cheek target");
      const mag = (i: number) =>
        Math.hypot(
          t.deltas[i * 3] as number,
          t.deltas[i * 3 + 1] as number,
          t.deltas[i * 3 + 2] as number,
        );
      const peak = Math.max(...Array.from(t.indices, (_, i) => mag(i)));
      return Array.from(t.indices).filter((_, i) => mag(i) > 0.5 * peak);
    })(),
    // The forehead: in front of the head, a little above the eyes, below the crown.
    forehead: skin.filter(
      (v) =>
        weight(v, /^(head|jaw)$/) > 0.9 &&
        (P[v * 3 + 2] as number) > 0.09 &&
        (P[v * 3 + 1] as number) > (eye[1] as number) + 0.035 &&
        (P[v * 3 + 1] as number) < (eye[1] as number) + 0.07,
    ),
    neck: where(/^neck0/, 0.5),
    chest: where(/^(spine01|spine02)$/, 0.6).filter((v) => (P[v * 3 + 2] as number) > 0.1),
    thigh: where(/^upperleg02\./),
    shin: where(/^lowerleg0[12]\./),
    belly: where(/^spine0[34]$/, 0.5).filter((v) => (P[v * 3 + 2] as number) > 0.1),
    hand: where(/^(wrist|metacarpal|finger)/, 0.95),
    foot: where(/^(foot|toe)/, 0.95),
    forearm: where(/^lowerarm0[12]\./),
  };

  it("have samples to measure", () => {
    for (const [name, vs] of Object.entries(sample)) expect(vs.length, name).toBeGreaterThan(20);
  });

  it("blush: cheeks, forehead, neck and chest, not the limbs or belly", () => {
    const m = masks.blush as Float32Array;
    expect(mean(m, sample.cheek)).toBeGreaterThan(0.9);
    expect(mean(m, sample.forehead)).toBeGreaterThan(0.5);
    expect(mean(m, sample.neck)).toBeGreaterThan(0.6);
    expect(mean(m, sample.chest)).toBeGreaterThan(0.3);
    for (const k of ["thigh", "shin", "hand", "foot", "forearm"] as const)
      expect(mean(m, sample[k]), k).toBeLessThan(0.05);
    // The chest eases out over the upper belly rather than ending on a line.
    expect(mean(m, sample.belly)).toBeLessThan(0.15);
  });

  it("exertion: the whole face, the neck and the chest, not the limbs", () => {
    const m = masks.exertion as Float32Array;
    expect(mean(m, sample.cheek)).toBeGreaterThan(0.9);
    expect(mean(m, sample.forehead)).toBeGreaterThan(0.9);
    expect(mean(m, sample.neck)).toBeGreaterThan(0.6);
    expect(mean(m, sample.chest)).toBeGreaterThan(0.5);
    for (const k of ["thigh", "shin", "foot"] as const)
      expect(mean(m, sample[k]), k).toBeLessThan(0.05);
    expect(mean(m, sample.belly)).toBeLessThan(0.2);
  });

  it("heat: everywhere", () => {
    const m = masks.heat as Float32Array;
    for (const [name, vs] of Object.entries(sample))
      expect(mean(m, vs), name).toBeGreaterThan(0.95);
  });

  it("fear pallor: the face and the neck", () => {
    const m = masks.fear as Float32Array;
    expect(mean(m, sample.cheek)).toBeGreaterThan(0.9);
    expect(mean(m, sample.forehead)).toBeGreaterThan(0.9);
    expect(mean(m, sample.neck)).toBeGreaterThan(0.6);
    for (const k of ["thigh", "shin", "belly", "hand", "foot", "forearm"] as const)
      expect(mean(m, sample[k]), k).toBeLessThan(0.05);
  });

  it("cold pallor: the hands and feet, the ears and nose, a little the forearms and shins", () => {
    const m = masks.cold as Float32Array;
    expect(mean(m, sample.hand)).toBeGreaterThan(0.9);
    expect(mean(m, sample.foot)).toBeGreaterThan(0.9);
    expect(mean(m, sample.forearm)).toBeGreaterThan(0.2);
    expect(mean(m, sample.forearm)).toBeLessThan(0.5);
    expect(mean(m, sample.shin)).toBeGreaterThan(0.2);
    for (const k of ["thigh", "belly", "chest", "neck", "forehead"] as const)
      expect(mean(m, sample[k]), k).toBeLessThan(0.05);
  });

  it("stay within 0..1 and have a zone for the forehead the other zones can be told from", () => {
    for (const [id, m] of Object.entries(masks)) {
      expect(Math.min(...m), id).toBeGreaterThanOrEqual(0);
      expect(Math.max(...m), id).toBeLessThanOrEqual(1);
    }
    expect(mean(zones.forehead, sample.forehead)).toBeGreaterThan(0.9);
    expect(mean(zones.forehead, sample.neck)).toBeLessThan(0.05);
    expect(mean(zones.forehead, sample.thigh)).toBeLessThan(0.05);
  });

  it("lips: the lips only", () => {
    const m = masks[LIP_STATE_LAYER.id] as Float32Array;
    expect(mean(m, sample.cheek)).toBeLessThan(0.3);
    expect(mean(m, sample.forehead)).toBeLessThan(0.05);
    expect(mean(m, sample.thigh)).toBeLessThan(0.05);
    expect(Math.max(...m)).toBeGreaterThan(0.9);
  });
});
