import { describe, expect, it } from "vitest";
import { groupFaces } from "../src/format/assetFormat.ts";
import { paintStopTable, STOP_TABLE_WIDTH } from "../src/surface/layers.ts";
import { SKIN_LAYERS } from "../src/surface/regions/index.ts";
import { LIPS_LAYER } from "../src/surface/regions/rest.ts";
import { skinZones } from "../src/surface/regions/skinZones.ts";
import {
  GOOSEBUMP_DENSITY_PER_CM2,
  GOOSEBUMP_HEIGHT,
  GOOSEBUMP_LAYER,
} from "../src/surface/regions/states.ts";
import { AREOLA_LAYER } from "../src/surface/regions/torso.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const n = assets.manifest.vertexCount;
const P = assets.positions;
const mask = GOOSEBUMP_LAYER.fields(assets).mask;
const tone = { melanin: 0.5, haemoglobin: 0.5, undertone: 0, override: null };
const paint = (signals: Record<string, number>) =>
  GOOSEBUMP_LAYER.paint({ tone, flush: 0.4, lips: 0.5, areola: 0.5, signals });

/** The body's skin vertices (faces of the `body` group). */
const skin = (() => {
  const out = new Set<number>();
  for (const f of groupFaces(assets, "body"))
    for (let k = 0; k < 4; k++) out.add(assets.faceVerts[f * 4 + k] as number);
  return [...out];
})();

/** Summed skin weight of the bones whose name matches `re`. */
function weight(v: number, re: RegExp): number {
  const bones = assets.manifest.skeleton.bones;
  let s = 0;
  for (let k = 0; k < 4; k++)
    if (re.test(bones[assets.skinIndex[v * 4 + k] as number]?.name ?? ""))
      s += assets.skinWeight[v * 4 + k] as number;
  return s;
}
const where = (re: RegExp, min = 0.95) => skin.filter((v) => weight(v, re) >= min);
const y = (v: number) => P[v * 3 + 1] as number;
const z = (v: number) => P[v * 3 + 2] as number;
const mean = (vs: number[]) => vs.reduce((s, v) => s + (mask[v] as number), 0) / vs.length;

describe("goosebumps: the measured papules", () => {
  it("stand 145 to 194 micrometres tall at 14 to 32 per cm²", () => {
    // Kim et al. 2014 (two episodes, 145 and 194 µm) and Otberg et al. 2004
    // follicle densities (14 per cm² on the calf to 32 on the upper arm).
    expect(GOOSEBUMP_HEIGHT).toBeCloseTo(194e-6, 9);
    expect(GOOSEBUMP_DENSITY_PER_CM2).toBeGreaterThanOrEqual(14);
    expect(GOOSEBUMP_DENSITY_PER_CM2).toBeLessThanOrEqual(32);
    const p = paint({ cold: 1 });
    // One bump per cell: density = 1 / spacing².
    const perCm2 = 1e-4 / (p.size * p.size);
    expect(perCm2).toBeCloseTo(GOOSEBUMP_DENSITY_PER_CM2, 6);
    expect(p.height * p.strength).toBeCloseTo(194e-6, 9);
    // A signal of 0.75 is the smaller measured papule.
    const small = paint({ cold: 0.75 });
    expect(small.height * small.strength).toBeCloseTo(145.5e-6, 9);
  });

  it("rise with cold or fear, either alone, and combine as independent triggers", () => {
    const s = (signals: Record<string, number>) => paint(signals).strength;
    expect(s({})).toBe(0);
    expect(s({ heat: 1, exertion: 1, blush: 1 })).toBe(0);
    expect(s({ cold: 1 })).toBe(1);
    expect(s({ fear: 1 })).toBe(1);
    expect(s({ cold: 0.5 })).toBeCloseTo(0.5, 9);
    // 1 - (1 - 0.5)(1 - 0.5): two half-strength triggers make three quarters.
    expect(s({ cold: 0.5, fear: 0.5 })).toBeCloseTo(0.75, 9);
  });

  it("is a bumps detail layer in the stack, painted into the stop table", () => {
    expect(GOOSEBUMP_LAYER.kind).toBe("detail");
    expect(GOOSEBUMP_LAYER.pattern).toBe("bumps");
    const l = SKIN_LAYERS.indexOf(GOOSEBUMP_LAYER);
    expect(l).toBeGreaterThanOrEqual(3);
    const table = paintStopTable(SKIN_LAYERS, {
      tone,
      flush: 0.4,
      lips: 0.5,
      areola: 0.5,
      signals: { cold: 1 },
    });
    const row = l * STOP_TABLE_WIDTH * 4;
    expect(table[row]).toBe(1);
    expect(table[row + 1]).toBe(2);
    expect(table[row + 2]).toBeCloseTo(194e-6, 9);
  });
});

describe("goosebumps: where hair-bearing skin is", () => {
  it("covers the measured sites: upper arm, forearm, thigh, calf, back, abdomen", () => {
    for (const [name, re] of [
      ["upper arm", /^upperarm0[12]\./],
      ["forearm", /^lowerarm0[12]\./],
      ["thigh", /^upperleg02\./],
      ["calf", /^lowerleg0[12]\./],
    ] as const) {
      const vs = where(re);
      expect(vs.length, name).toBeGreaterThan(50);
      expect(mean(vs), name).toBeGreaterThan(0.95);
    }
    // The spine's joints lie at z of about 0; the back is behind them, the belly well ahead.
    const back = where(/^spine0[1-4]$/, 0.9).filter((v) => z(v) < -0.03);
    expect(back.length).toBeGreaterThan(50);
    expect(mean(back)).toBeGreaterThan(0.95);
    const belly = where(/^spine0[34]$/, 0.5).filter((v) => z(v) > 0.1);
    expect(belly.length).toBeGreaterThan(50);
    expect(mean(belly)).toBeGreaterThan(0.95);
  });

  it("leaves out the palms but keeps the backs of the hands", () => {
    // In the rest pose each hand hangs with its palm toward the thigh and the
    // ground, so the palm side is the side of the hand whose skin faces down and
    // inward; its back faces up and outward.
    const normal = (v: number) => skinZones(assets).normals.subarray(v * 3, v * 3 + 3);
    for (const [side, toBody] of [
      ["L", -1],
      ["R", 1],
    ] as const) {
      const hand = where(new RegExp(`^(wrist|metacarpal|finger).*\\.${side}$`), 0.9);
      const facing = (sign: number) =>
        hand.filter((v) => {
          const [nx, ny] = normal(v) as unknown as [number, number];
          return sign * (0.7 * toBody * nx - 0.7 * ny) > 0.6;
        });
      const palm = facing(1);
      const back = facing(-1);
      expect(palm.length, `${side} palm vertices`).toBeGreaterThan(40);
      expect(back.length, `${side} back-of-hand vertices`).toBeGreaterThan(40);
      expect(mean(palm), `${side} palm`).toBeLessThan(0.15);
      expect(mean(back), `${side} back of hand`).toBeGreaterThan(0.85);
    }
  });

  it("leaves out the soles but keeps the tops of the feet", () => {
    for (const side of ["L", "R"]) {
      const foot = where(new RegExp(`^(foot|toe).*\\.${side}$`), 0.9).sort((a, b) => y(a) - y(b));
      const sole = foot.slice(0, Math.floor(foot.length * 0.08));
      const top = foot.slice(-Math.floor(foot.length * 0.05));
      expect(mean(sole), `${side} sole`).toBeLessThan(0.1);
      expect(mean(top), `${side} top of foot`).toBeGreaterThan(0.9);
    }
  });

  it("leaves out the lips, the areola and the face", () => {
    const lips = LIPS_LAYER.fields(assets).mask;
    const areola = AREOLA_LAYER.fields(assets).mask;
    let checked = 0;
    for (const v of skin) {
      if ((lips[v] as number) > 0.8 || (areola[v] as number) > 0.9) {
        expect(mask[v], `vertex ${v} on lips or areola`).toBeLessThan(0.11);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
    // The face and scalp: above the eyes' height and in front of the ears.
    const face = where(/^(head|jaw)$/, 0.95);
    expect(face.length).toBeGreaterThan(100);
    expect(mean(face)).toBeLessThan(0.1);
  });

  it("stays within 0..1 and is zero only where the skin has no hair follicles to raise", () => {
    expect(mask.length).toBe(n);
    expect(Math.min(...mask)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...mask)).toBeLessThanOrEqual(1);
    // Both outcomes occur: bumps rise on some skin and not on other skin.
    expect(skin.some((v) => (mask[v] as number) > 0.99)).toBe(true);
    expect(skin.some((v) => (mask[v] as number) < 0.01)).toBe(true);
  });
});
