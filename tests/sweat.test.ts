import { describe, expect, it } from "vitest";
import { groupFaces, jointPosition } from "../src/format/assetFormat.ts";
import { paintStopTable, STOP_TABLE_WIDTH, surfaceChange } from "../src/surface/layers.ts";
import { SKIN_LAYERS } from "../src/surface/regions/index.ts";
import {
  SWEAT_EXERCISE_LAYER,
  SWEAT_RATE,
  SWEAT_REST_LAYER,
  SWEAT_ROUGHNESS,
  SWEAT_SPECULAR,
  wetness,
} from "../src/surface/regions/states.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const tone = { melanin: 0.5, haemoglobin: 0.5, undertone: 0, override: null };
const paint = (layer: typeof SWEAT_REST_LAYER, signals: Record<string, number>) =>
  layer.paint({ tone, flush: 0.4, lips: 0.5, areola: 0.5, signals });

describe("sweat sheen: the regional sweat map", () => {
  it("is Taylor and Machado-Moreira's pooled regional rates, passive heating and exercise", () => {
    // Table 4, B2 and B3 (mg per cm² per minute): spot checks of the transcription.
    expect(SWEAT_RATE.head).toEqual([0.489, 2.45]);
    expect(SWEAT_RATE.back).toEqual([0.564, 1.658]);
    expect(SWEAT_RATE.thigh).toEqual([0.179, 0.706]);
    expect(SWEAT_RATE.footSole).toEqual([0.24, 0.464]);
    for (const [name, [rest, exercise]] of Object.entries(SWEAT_RATE))
      expect(exercise, name).toBeGreaterThan(rest);
  });

  it("makes wetness rise with the rate and saturate", () => {
    expect(wetness(0)).toBe(0);
    expect(wetness(0.5)).toBeCloseTo(0.5, 9);
    expect(wetness(0.2)).toBeLessThan(wetness(0.4));
    expect(wetness(50)).toBeGreaterThan(0.98);
    expect(wetness(50)).toBeLessThan(1);
  });

  it("paints roughness down and specular up, within what the material can take", () => {
    expect(SWEAT_ROUGHNESS).toBeLessThan(0);
    expect(0.52 + SWEAT_ROUGHNESS).toBeGreaterThanOrEqual(0.03);
    expect(SWEAT_SPECULAR).toBeGreaterThan(0);
    const p = paint(SWEAT_REST_LAYER, { heat: 1 });
    expect(p.roughness).toBe(SWEAT_ROUGHNESS);
    expect(p.specular).toBe(SWEAT_SPECULAR);
  });

  it("draws the passive-heating map for heat and the exercise map for exertion", () => {
    const s = (l: typeof SWEAT_REST_LAYER, signals: Record<string, number>) =>
      paint(l, signals).strength;
    expect(s(SWEAT_REST_LAYER, {})).toBe(0);
    expect(s(SWEAT_EXERCISE_LAYER, {})).toBe(0);
    expect(s(SWEAT_REST_LAYER, { heat: 0.6 })).toBeCloseTo(0.6, 9);
    expect(s(SWEAT_EXERCISE_LAYER, { heat: 0.6 })).toBe(0);
    expect(s(SWEAT_EXERCISE_LAYER, { exertion: 0.7 })).toBeCloseTo(0.7, 9);
    expect(s(SWEAT_REST_LAYER, { exertion: 0.7 })).toBe(0);
    // Both together share one sweat drive, 1 - (1 - heat)(1 - exertion), between the maps.
    const a = s(SWEAT_REST_LAYER, { heat: 1, exertion: 1 });
    const b = s(SWEAT_EXERCISE_LAYER, { heat: 1, exertion: 1 });
    expect(a).toBeCloseTo(0.5, 9);
    expect(b).toBeCloseTo(0.5, 9);
    const drive = 1 - (1 - 0.5) * (1 - 0.25);
    expect(
      s(SWEAT_REST_LAYER, { heat: 0.5, exertion: 0.25 }) +
        s(SWEAT_EXERCISE_LAYER, { heat: 0.5, exertion: 0.25 }),
    ).toBeCloseTo(drive, 9);
    expect(s(SWEAT_REST_LAYER, { cold: 1, blush: 1, fear: 1 })).toBe(0);
  });

  it("follows the heat layers in the stack and fills the table's surface rows", () => {
    const rest = SKIN_LAYERS.indexOf(SWEAT_REST_LAYER);
    const exercise = SKIN_LAYERS.indexOf(SWEAT_EXERCISE_LAYER);
    expect(rest).toBeGreaterThan(SKIN_LAYERS.findIndex((l) => l.id === "heat-flush"));
    expect(exercise).toBeGreaterThan(rest);
    const table = paintStopTable(SKIN_LAYERS, {
      tone,
      flush: 0,
      lips: 0.5,
      areola: 0.5,
      signals: { heat: 1 },
    });
    const row = rest * STOP_TABLE_WIDTH * 4;
    expect(table[row]).toBe(1);
    expect(table[row + 1]).toBe(4);
    expect(table[row + 2]).toBeCloseTo(SWEAT_ROUGHNESS, 3);
    expect(table[row + 3]).toBeCloseTo(SWEAT_SPECULAR, 3);
    const fields = SKIN_LAYERS.map(() => [1, 0] as [number, number]);
    expect(surfaceChange(table, fields).roughness).toBeLessThan(0);
  });
});

describe("sweat sheen: where the body sweats", () => {
  const assets = loadFixtureAssets();
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
  const z = (v: number) => P[v * 3 + 2] as number;
  const y = (v: number) => P[v * 3 + 1] as number;
  const rest = SWEAT_REST_LAYER.fields(assets).mask;
  const exercise = SWEAT_EXERCISE_LAYER.fields(assets).mask;
  const eye = new Float32Array(3);
  jointPosition(assets, assets.positions, "eye.L____head", eye, 0);
  const eyeY = eye[1] as number;
  const mean = (m: Float32Array, vs: number[]) =>
    vs.reduce((s, v) => s + (m[v] as number), 0) / vs.length;

  const sites = {
    head: where(/^(head|jaw)$/, 0.95).filter((v) => z(v) > 0.08),
    // The forehead: in front of the head, a little above the eyes, below the crown.
    forehead: where(/^(head|jaw)$/, 0.9).filter(
      (v) => z(v) > 0.09 && y(v) > eyeY + 0.035 && y(v) < eyeY + 0.07,
    ),
    back: where(/^spine0[1-4]$/, 0.9).filter((v) => z(v) < -0.03),
    chest: where(/^(spine01|spine02)$/, 0.6).filter((v) => z(v) > 0.1),
    abdomen: where(/^spine0[34]$/, 0.5).filter((v) => z(v) > 0.1),
    upperArm: where(/^upperarm0[12]\./),
    forearm: where(/^lowerarm0[12]\./),
    thigh: where(/^upperleg02\./),
    shin: where(/^lowerleg0[12]\./),
    // The feet: the lowest vertices of the foot are the sole; the highest, the top.
    sole: (() => {
      const f = where(/^(foot|toe)/, 0.9).sort((a, b) => y(a) - y(b));
      return f.slice(0, Math.floor(f.length * 0.08));
    })(),
    footTop: (() => {
      const f = where(/^(foot|toe)/, 0.9).sort((a, b) => y(a) - y(b));
      return f.slice(-Math.floor(f.length * 0.05));
    })(),
  };

  it("has sites to measure", () => {
    for (const [name, vs] of Object.entries(sites)) expect(vs.length, name).toBeGreaterThan(20);
  });

  it("reads each site's wetness from the pooled rate, to within the zones' blending", () => {
    // Back at rest 0.564, thigh 0.179, head 0.489 (the forehead more); at exercise 1.658, 0.706, 2.45.
    for (const [name, site, restRate, exRate] of [
      ["back", sites.back, 0.564, 1.658],
      ["thigh", sites.thigh, 0.179, 0.706],
      ["upperArm", sites.upperArm, 0.25, 0.606],
      ["forearm", sites.forearm, 0.37, 0.927],
      ["shin", sites.shin, 0.189, 0.886],
    ] as const) {
      expect(mean(rest, site), `${name} at rest`).toBeCloseTo(wetness(restRate), 1);
      expect(mean(exercise, site), `${name} at exercise`).toBeCloseTo(wetness(exRate), 1);
    }
  });

  it("ranks the sites as the measurements do: head and back wettest at rest, thighs and legs driest", () => {
    const m = (name: keyof typeof sites) => mean(rest, sites[name]);
    expect(m("head")).toBeGreaterThan(m("chest"));
    expect(m("back")).toBeGreaterThan(m("chest"));
    expect(m("chest")).toBeGreaterThan(m("thigh"));
    expect(m("back")).toBeGreaterThan(m("shin"));
    expect(m("forearm")).toBeGreaterThan(m("upperArm"));
    // The forehead is the wettest of all (0.99 against the back's 0.59 in the abstract).
    expect(m("forehead")).toBeGreaterThan(m("back"));
    expect(m("forehead")).toBeCloseTo(wetness(0.99), 1);
  });

  it("is more even in exercise than at rest, as the measurements say", () => {
    const names = [
      "head",
      "back",
      "chest",
      "abdomen",
      "upperArm",
      "forearm",
      "thigh",
      "shin",
    ] as const;
    const spread = (m: Float32Array) => {
      const v = names.map((n) => mean(m, sites[n]));
      return Math.max(...v) / Math.min(...v);
    };
    expect(spread(exercise)).toBeLessThan(0.8 * spread(rest));
    // And wetter everywhere.
    for (const n of names)
      expect(mean(exercise, sites[n]), n).toBeGreaterThan(mean(rest, sites[n]));
  });

  it("separates the sole from the top of the foot", () => {
    expect(mean(rest, sites.footTop)).toBeGreaterThan(mean(rest, sites.sole) + 0.05);
    expect(mean(exercise, sites.footTop)).toBeGreaterThan(mean(exercise, sites.sole) + 0.05);
  });

  it("stays within 0..1", () => {
    for (const m of [rest, exercise]) {
      expect(Math.min(...m)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...m)).toBeLessThanOrEqual(1);
    }
  });
});
