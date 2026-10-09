/**
 * The expression lines (src/surface/regions/faceLines.ts): where each set lies
 * on the base mesh, and how the face signals and the figure's age drive it.
 */
import { describe, expect, it } from "vitest";
import { jointPosition } from "../src/format/assetFormat.ts";
import { buildLayerFields, type DetailLayer, type SkinPaintInput } from "../src/surface/layers.ts";
import { CREASE_LAYERS } from "../src/surface/regions/creases.ts";
import {
  EXPRESSION_COUNT,
  EXPRESSION_DEPTH,
  EXPRESSION_LINE_LAYERS,
  expressionAgeFactor,
  expressionLineId,
} from "../src/surface/regions/faceLines.ts";
import { SKIN_LAYERS } from "../src/surface/regions/index.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const n = assets.manifest.vertexCount;
const P = assets.positions;
const BODY = 13380;
const fields = buildLayerFields(assets, EXPRESSION_LINE_LAYERS);
const index = (id: string) => EXPRESSION_LINE_LAYERS.findIndex((l) => l.id === id);
const mask = (l: number, v: number) => fields[(l * n + v) * 3] as number;
const coord = (l: number, v: number) => fields[(l * n + v) * 3 + 1] as number;
const strong = (l: number) => {
  const out: number[] = [];
  for (let v = 0; v < n; v++) if (mask(l, v) > 0.5) out.push(v);
  return out;
};
const at = (bone: string): number[] => {
  const p = new Float32Array(3);
  jointPosition(assets, P, `${bone}____head`, p, 0);
  return Array.from(p);
};
const eye = at("eye.L");
const [ex, ey, ez] = eye as [number, number, number];
const brow = at("oculi01.L");
const outer = at("oculi02.L");
const wing = at("levator03.L");
const lipBones = ["oris01", "oris02", "oris03.L", "oris03.R"].map(at);
const pos = (v: number) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]] as number[];

const input = (signals: Record<string, number> = {}, age?: number): SkinPaintInput => ({
  tone: { melanin: 0.4, haemoglobin: 0.5, undertone: 0, override: null },
  flush: 0.4,
  lips: 0.5,
  areola: 0.5,
  signals,
  ...(age !== undefined && { age }),
});
const layer = (id: string): DetailLayer => {
  const l = EXPRESSION_LINE_LAYERS.find((x) => x.id === id);
  if (!l) throw new Error(`no layer ${id}`);
  return l;
};
const strength = (id: string, signals: Record<string, number>, age = 40) =>
  layer(id).paint(input(signals, age)).strength;

describe("the expression line layers", () => {
  it("are crease layers after the joints', each with an id of its own", () => {
    expect(EXPRESSION_LINE_LAYERS.map((l) => l.id)).toEqual([
      "lines.forehead",
      "lines.crows-feet",
      "lines.glabella",
      "lines.nasolabial",
      "lines.nose",
    ]);
    for (const l of EXPRESSION_LINE_LAYERS) {
      expect(l.kind).toBe("detail");
      expect(l.pattern).toBe("creases");
    }
    const ids = SKIN_LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    const first = ids.indexOf(EXPRESSION_LINE_LAYERS[0]?.id as string);
    expect(first).toBe(ids.indexOf(CREASE_LAYERS[CREASE_LAYERS.length - 1]?.id as string) + 1);
    expect(expressionLineId("crows-feet")).toBe("lines.crows-feet");
  });

  it("reach no helper geometry, the lips or the eyeballs", () => {
    EXPRESSION_LINE_LAYERS.forEach((l, k) => {
      for (let v = 0; v < n; v++) {
        if (mask(k, v) < 0.05) continue;
        expect(v, `${l.id} vertex ${v}`).toBeLessThan(BODY);
        for (const b of lipBones)
          expect(
            Math.hypot(...pos(v).map((x, i) => x - (b[i] as number))),
            `${l.id} vertex ${v} near a lip bone`,
          ).toBeGreaterThan(0.009);
        const [x, y, z] = pos(v) as [number, number, number];
        expect(
          Math.min(Math.hypot(x - ex, y - ey, z - ez), Math.hypot(x + ex, y - ey, z - ez)),
          `${l.id} vertex ${v} on the eyeball`,
        ).toBeGreaterThan(0.012);
      }
    });
  });

  it("put the forehead's lines above the brows, between the temples, running up the forehead", () => {
    const l = index("lines.forehead");
    const covered = strong(l);
    expect(covered.length).toBeGreaterThan(10);
    let sxy = 0;
    const ys = covered.map((v) => pos(v)[1] as number);
    const cs = covered.map((v) => coord(l, v));
    const [my, mc] = [
      ys.reduce((a, b) => a + b) / ys.length,
      cs.reduce((a, b) => a + b) / cs.length,
    ];
    for (const [i, v] of covered.entries()) {
      const [x, y] = pos(v) as [number, number];
      expect(y, `vertex ${v}`).toBeGreaterThan((brow[1] as number) + 0.015);
      expect(y, `vertex ${v}`).toBeLessThan((brow[1] as number) + 0.075);
      expect(Math.abs(x), `vertex ${v}`).toBeLessThan(0.065);
      sxy += ((ys[i] as number) - my) * ((cs[i] as number) - mc);
    }
    expect(sxy, "the coordinate rises with the skin").toBeGreaterThan(0);
  });

  it("put the glabella's furrows between the brows, running across them", () => {
    const l = index("lines.glabella");
    const covered = strong(l);
    expect(covered.length).toBeGreaterThan(10);
    const xs = covered.map((v) => pos(v)[0] as number);
    const cs = covered.map((v) => coord(l, v));
    for (const v of covered) {
      const [x, y] = pos(v) as [number, number];
      expect(Math.abs(x), `vertex ${v}`).toBeLessThan(0.02);
      expect(y, `vertex ${v}`).toBeGreaterThan(eye[1] as number);
      expect(y, `vertex ${v}`).toBeLessThan((brow[1] as number) + 0.04);
    }
    const [mx, mc] = [
      xs.reduce((a, b) => a + b) / xs.length,
      cs.reduce((a, b) => a + b) / cs.length,
    ];
    const sxy = xs.reduce((s, x, i) => s + (x - mx) * ((cs[i] as number) - mc), 0);
    expect(sxy, "the coordinate runs across the face").toBeGreaterThan(0);
  });

  for (const side of ["L", "R"] as const) {
    const sign = side === "L" ? 1 : -1;
    it(`put the ${side} crow's feet lateral of the eye's outer corner, fanning by angle`, () => {
      const l = index("lines.crows-feet");
      const covered = strong(l).filter((v) => Math.sign(P[v * 3] as number) === sign);
      expect(covered.length).toBeGreaterThan(8);
      const angles: number[] = [];
      const cs: number[] = [];
      for (const v of covered) {
        const [x, y, z] = pos(v) as [number, number, number];
        const d = [
          x * sign - (outer[0] as number),
          y - (outer[1] as number),
          z - (outer[2] as number),
        ];
        expect(Math.sign(x), `vertex ${v}`).toBe(sign);
        expect(d[0] as number, `vertex ${v} lateral`).toBeGreaterThan(-0.004);
        expect(Math.hypot(...d), `vertex ${v} reach`).toBeLessThan(0.036);
        angles.push(Math.atan2(d[1] as number, Math.hypot(d[0] as number, d[2] as number)));
        cs.push(coord(l, v));
      }
      const [ma, mc] = [
        angles.reduce((a, b) => a + b) / angles.length,
        cs.reduce((a, b) => a + b) / cs.length,
      ];
      const sac = angles.reduce((s, a, i) => s + (a - ma) * ((cs[i] as number) - mc), 0);
      expect(sac, "the coordinate rises with the angle").toBeGreaterThan(0);
    });

    it(`put the ${side} nasolabial fold on its side, from the nose's wing down the cheek`, () => {
      const l = index("lines.nasolabial");
      const covered = strong(l).filter((v) => Math.sign(P[v * 3] as number) === sign);
      expect(covered.length).toBeGreaterThan(30);
      let lateral = 0;
      let medial = 0;
      let nl = 0;
      let nm = 0;
      for (const v of covered) {
        const [x, y] = pos(v) as [number, number];
        expect(Math.sign(x), `vertex ${v}`).toBe(sign);
        expect(y, `vertex ${v}`).toBeLessThan((wing[1] as number) + 0.01);
        expect(y, `vertex ${v}`).toBeGreaterThan(0.62);
        if (coord(l, v) > 0.5) {
          lateral += x * sign;
          nl++;
        } else {
          medial += x * sign;
          nm++;
        }
      }
      expect(nl).toBeGreaterThan(5);
      expect(nm).toBeGreaterThan(5);
      expect(lateral / nl, "the coordinate's high side is the cheek's").toBeGreaterThan(
        medial / nm,
      );
    });
  }

  it("put the nose's lines on its bridge", () => {
    const l = index("lines.nose");
    const covered = strong(l);
    expect(covered.length).toBeGreaterThan(10);
    for (const v of covered) {
      const [x, y] = pos(v) as [number, number];
      expect(Math.abs(x), `vertex ${v}`).toBeLessThan(0.015);
      expect(y, `vertex ${v}`).toBeGreaterThan(wing[1] as number);
      expect(y, `vertex ${v}`).toBeLessThan(eye[1] as number);
    }
  });

  it("are mirror images: the right's lines are the left's reflected", () => {
    for (const name of ["crows-feet", "nasolabial"]) {
      const l = index(`lines.${name}`);
      let diff = 0;
      let total = 0;
      for (let v = 0; v < BODY; v += 1) {
        const [x, y, z] = pos(v) as [number, number, number];
        if (x <= 0 || mask(l, v) < 0.05) continue;
        // The vertex across the face: the nearest to the reflection.
        let best = Number.POSITIVE_INFINITY;
        let partner = v;
        for (let w = 0; w < BODY; w++) {
          if (Math.abs((P[w * 3 + 1] as number) - y) > 0.004) continue;
          const d = ((P[w * 3] as number) + x) ** 2 + ((P[w * 3 + 2] as number) - z) ** 2;
          if (d < best) {
            best = d;
            partner = w;
          }
        }
        diff += Math.abs(mask(l, v) - mask(l, partner)) + Math.abs(coord(l, v) - coord(l, partner));
        total++;
      }
      expect(total, name).toBeGreaterThan(10);
      expect(diff / total, name).toBeLessThan(0.08);
    }
  });
});

describe("the expression lines' paint", () => {
  it("is none at rest, whatever the age", () => {
    for (const l of EXPRESSION_LINE_LAYERS)
      for (const age of [6, 25, 70])
        expect(l.paint(input({}, age)).strength, `${l.id} at ${age}`).toBe(0);
  });

  it("follows the signal that drives each set, and only that set's drivers", () => {
    const only = (signal: string, ids: string[]) => {
      for (const l of EXPRESSION_LINE_LAYERS) {
        const s = l.paint(input({ [signal]: 1 }, 40)).strength;
        if (ids.includes(l.id)) expect(s, `${signal} on ${l.id}`).toBeGreaterThan(0.9);
        else expect(s, `${signal} on ${l.id}`).toBe(0);
      }
    };
    only("face.browRaise", ["lines.forehead"]);
    only("face.browFurrow", ["lines.glabella"]);
    only("face.noseWrinkle", ["lines.nose"]);
    only("face.squint", ["lines.crows-feet"]);
    only("face.nasolabial", ["lines.nasolabial"]);
    // A smile lines the cheeks and the eyes' corners without a squint, a little less than their own signals.
    for (const id of ["lines.crows-feet", "lines.nasolabial"]) {
      const s = strength(id, { "face.smile": 1 });
      expect(s, id).toBeGreaterThan(0.4);
      expect(s, id).toBeLessThan(1);
    }
  });

  it("grows with the signal, smoothly, from nothing", () => {
    let last = 0;
    for (const w of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
      const s = strength("lines.forehead", { "face.browRaise": w });
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
    expect(strength("lines.forehead", { "face.browRaise": 0.05 })).toBe(0);
    expect(last).toBe(1);
  });

  it("deepens with age: a child barely lines, an old face does most", () => {
    const f = (age: number) => expressionAgeFactor(age);
    expect(f(6)).toBeLessThan(0.3);
    expect(f(40)).toBe(1);
    expect(f(75)).toBeGreaterThan(1.2);
    let last = 0;
    for (let age = 1; age <= 90; age += 1) {
      expect(f(age)).toBeGreaterThanOrEqual(last);
      last = f(age);
    }
    expect(expressionAgeFactor(undefined)).toBe(expressionAgeFactor(30));
    const h = (age: number) => layer("lines.glabella").paint(input({ "face.browFurrow": 1 }, age));
    expect((h(6) as { height: number }).height).toBeLessThan(
      (h(40) as { height: number }).height * 0.3,
    );
  });

  it("are fractions of a millimetre and a few grooves, as a face's are", () => {
    for (const [set, depth] of Object.entries(EXPRESSION_DEPTH)) {
      expect(depth, set).toBeGreaterThan(0.0001);
      expect(depth * expressionAgeFactor(90), set).toBeLessThan(0.001);
    }
    for (const [set, count] of Object.entries(EXPRESSION_COUNT)) {
      expect(count, set).toBeGreaterThanOrEqual(1);
      expect(count, set).toBeLessThanOrEqual(4);
    }
    const paint = layer("lines.forehead").paint(input({ "face.browRaise": 1 }, 40)) as {
      height: number;
      size: number;
    };
    expect(paint.height).toBe(EXPRESSION_DEPTH.forehead);
    expect(paint.size).toBe(EXPRESSION_COUNT.forehead);
  });
});
