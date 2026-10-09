/**
 * The expression lines (src/surface/regions/faceLines.ts): where each set lies
 * on the base mesh, and how the face signals and the figure's age drive it.
 */
import { describe, expect, it } from "vitest";
import { jointPosition } from "../src/format/assetFormat.ts";
import {
  buildLayerFields,
  type ColourLayer,
  type DetailLayer,
  type SkinPaintInput,
} from "../src/surface/layers.ts";
import { CREASE_LAYERS } from "../src/surface/regions/creases.ts";
import {
  distanceFromBrows,
  EXPRESSION_COUNT,
  EXPRESSION_DEPTH,
  EXPRESSION_LINE_LAYERS,
  expressionAgeFactor,
  expressionLineId,
  FOREHEAD_FROM,
  FOREHEAD_SPAN,
  FOREHEAD_STOPS,
  GLABELLA_HALF,
  GLABELLA_STOPS,
  LINE_DARKENING_MAX,
  lineShade,
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
const layer = (id: string): DetailLayer | ColourLayer => {
  const l = EXPRESSION_LINE_LAYERS.find((x) => x.id === id);
  if (!l) throw new Error(`no layer ${id}`);
  return l;
};
/** The forehead's and the furrows' lines are colour (thin lines on an exactly linear coordinate); the rest relief. */
const isColourLine = (id: string) => id === "lines.forehead" || id === "lines.glabella";
const detailLayer = (id: string): DetailLayer => {
  const l = layer(id);
  if (l.kind !== "detail") throw new Error(`${id} is not a relief layer`);
  return l;
};
const strength = (id: string, signals: Record<string, number>, age = 40) =>
  layer(id).paint(input(signals, age)).strength;

describe("the expression line layers", () => {
  it("are layers after the joints', each with an id of its own: the forehead's and the furrows' lines of colour, the rest crease relief", () => {
    expect(EXPRESSION_LINE_LAYERS.map((l) => l.id)).toEqual([
      "lines.forehead",
      "lines.crows-feet",
      "lines.glabella",
      "lines.nasolabial",
      "lines.nose",
    ]);
    for (const l of EXPRESSION_LINE_LAYERS) {
      if (isColourLine(l.id)) {
        expect(l.kind ?? "colour", l.id).toBe("colour");
        expect((l as ColourLayer).blend, l.id).toBe("multiply");
      } else {
        expect(detailLayer(l.id).pattern, l.id).toBe("creases");
      }
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

  it("reach no further than the anatomy: nothing above the brows' reach, or beyond a face's own extent", () => {
    // Where a layer's mask is more than a trace, in metres from the landmarks it is measured from.
    const bound = (id: string, x: number, y: number, z: number): boolean => {
      const b = brow as [number, number, number];
      const o = outer as [number, number, number];
      switch (id) {
        // Frontalis lines stop 5 to 7 cm above the brows, and fade toward the temples.
        case "lines.forehead":
          return y <= b[1] + FOREHEAD_FROM + FOREHEAD_SPAN && y >= b[1] && Math.abs(x) <= 0.066;
        // Glabellar lines are short: 1 to 2.5 cm, between and just above the inner brows.
        case "lines.glabella":
          return y <= b[1] + 0.028 && y >= (eye[1] as number) && Math.abs(x) <= GLABELLA_HALF;
        case "lines.crows-feet":
          return Math.hypot(Math.abs(x) - o[0], y - o[1], z - o[2]) <= 0.036;
        case "lines.nasolabial":
          return y <= (wing[1] as number) + 0.012 && y >= 0.62 && Math.abs(x) <= 0.07;
        default:
          return Math.abs(x) <= 0.016 && y >= (wing[1] as number) && y <= (eye[1] as number);
      }
    };
    EXPRESSION_LINE_LAYERS.forEach((l, k) => {
      for (let v = 0; v < n; v++) {
        if (mask(k, v) <= 0.02) continue;
        const [x, y, z] = pos(v) as [number, number, number];
        expect(
          bound(l.id, x, y, z),
          `${l.id} vertex ${v} at ${x.toFixed(3)}, ${y.toFixed(3)}`,
        ).toBe(true);
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
      expect(y, `vertex ${v}`).toBeGreaterThan(brow[1] as number);
      expect(y, `vertex ${v}`).toBeLessThan((brow[1] as number) + FOREHEAD_FROM + FOREHEAD_SPAN);
      expect(Math.abs(x), `vertex ${v}`).toBeLessThan(0.066);
      sxy += ((ys[i] as number) - my) * ((cs[i] as number) - mc);
    }
    expect(sxy, "the coordinate rises with the skin").toBeGreaterThan(0);
  });

  it("put the glabella's furrows between the brows, running across them", () => {
    const l = index("lines.glabella");
    const covered = strong(l);
    expect(covered.length).toBeGreaterThan(5);
    const xs = covered.map((v) => pos(v)[0] as number);
    const cs = covered.map((v) => coord(l, v));
    for (const v of covered) {
      const [x, y] = pos(v) as [number, number];
      expect(Math.abs(x), `vertex ${v}`).toBeLessThan(GLABELLA_HALF);
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
    // A line of colour darkens by a fraction that grows with age, and never past the most.
    const dark = (age: number) => 1 - (lineShade(age)[0] as number);
    expect(dark(6)).toBeLessThan(dark(40) * 0.3);
    expect(dark(75)).toBeGreaterThan(dark(40));
    for (const age of [1, 6, 25, 40, 75, 95])
      for (const c of lineShade(age)) {
        expect(c).toBeLessThanOrEqual(1);
        expect(c).toBeGreaterThanOrEqual(1 - LINE_DARKENING_MAX);
      }
  });

  it("are fractions of a millimetre and a few grooves, as a face's are", () => {
    for (const [set, depth] of Object.entries(EXPRESSION_DEPTH)) {
      expect(depth, set).toBeGreaterThan(0.0001);
      expect(depth * expressionAgeFactor(90), set).toBeLessThan(0.001);
    }
    for (const [set, count] of Object.entries(EXPRESSION_COUNT)) {
      expect(count, set).toBeGreaterThanOrEqual(1);
      expect(count, set).toBeLessThanOrEqual(5);
    }
    const paint = detailLayer("lines.crows-feet").paint(input({ "face.squint": 1 }, 40)) as {
      height: number;
      size: number;
    };
    expect(paint.height).toBe(EXPRESSION_DEPTH.crowsFeet);
    expect(paint.size).toBe(EXPRESSION_COUNT.crowsFeet);
  });
});

describe("the distance along the skin from the brows", () => {
  it("is a metric: no edge between two reached vertices changes it by more than the edge's length", () => {
    // Stored in single precision it was not: a vertex's stored distance rounded below the
    // distance it was queued with, so it never relaxed its neighbours, and the forehead's
    // midline (and with it the centre of its lines) was never reached.
    const d = distanceFromBrows(assets);
    let reached = 0;
    for (let q = 0; q < assets.faceVerts.length / 4; q++)
      for (let k = 0; k < 4; k++) {
        const a = assets.faceVerts[q * 4 + k] as number;
        const b = assets.faceVerts[q * 4 + ((k + 1) % 4)] as number;
        if (a >= BODY || b >= BODY || !Number.isFinite(d[a] as number)) continue;
        const edge = Math.hypot(
          (P[a * 3] as number) - (P[b * 3] as number),
          (P[a * 3 + 1] as number) - (P[b * 3 + 1] as number),
          (P[a * 3 + 2] as number) - (P[b * 3 + 2] as number),
        );
        reached++;
        // A neighbour of a reached vertex is reached too, when it is skin of the face.
        if (Number.isFinite(d[b] as number))
          expect(Math.abs((d[a] as number) - (d[b] as number))).toBeLessThanOrEqual(edge + 1e-9);
      }
    expect(reached).toBeGreaterThan(100);
  });

  it("reaches the forehead's midline, up to the top of the forehead's lines", () => {
    const d = distanceFromBrows(assets);
    const top = (brow[1] as number) + FOREHEAD_FROM + FOREHEAD_SPAN;
    let n = 0;
    for (let v = 0; v < BODY; v++) {
      const [x, y, z] = pos(v) as [number, number, number];
      if (Math.abs(x) > 0.001 || y < (brow[1] as number) + 0.01 || y > top - 0.01 || z < 0.1)
        continue;
      expect(d[v], `midline vertex ${v} at y ${y.toFixed(3)}`).toBeLessThan(0.1);
      n++;
    }
    expect(n).toBeGreaterThan(5);
  });
});

describe("the forehead's and the furrows' lines of colour", () => {
  it("carry a coordinate exactly linear in height (forehead) and across (furrows), so a line is straight", () => {
    const f = index("lines.forehead");
    const g = index("lines.glabella");
    let nf = 0;
    let ng = 0;
    for (let v = 0; v < BODY; v++) {
      const [x, y] = pos(v) as [number, number];
      // Where the line can fall: the mask is more than a trace, so no vertex is stored clamped.
      if (mask(f, v) > 0.02) {
        expect(coord(f, v), `forehead vertex ${v}`).toBeCloseTo(
          (y - ((brow[1] as number) + FOREHEAD_FROM)) / FOREHEAD_SPAN,
          5,
        );
        nf++;
      }
      if (mask(g, v) > 0.02) {
        expect(coord(g, v), `furrow vertex ${v}`).toBeCloseTo(
          (x + GLABELLA_HALF) / (2 * GLABELLA_HALF),
          5,
        );
        ng++;
      }
    }
    expect(nf).toBeGreaterThan(8);
    expect(ng).toBeGreaterThan(4);
  });

  it("stay straight across the base mesh's triangles: the interpolated coordinate is constant along a horizontal (forehead) or vertical (furrow) cut to within half a millimetre", () => {
    // What the rasteriser does: interpolate the three vertices' coordinates across each
    // triangle (a quad is two, whichever way it is split), then cut the surface by a plane.
    const check = (id: string, axis: 0 | 1, from: number, span: number, cuts: number[]) => {
      const l = index(id);
      let crossings = 0;
      let worst = 0;
      for (let q = 0; q < assets.faceVerts.length / 4; q++) {
        const [a, b, c, d] = [0, 1, 2, 3].map((k) => assets.faceVerts[q * 4 + k] as number) as [
          number,
          number,
          number,
          number,
        ];
        for (const tri of [
          [a, b, c],
          [a, c, d],
          [a, b, d],
          [b, c, d],
        ] as const) {
          if (tri.some((v) => v >= BODY || mask(l, v) <= 0.02)) continue;
          for (const cut of cuts)
            for (let e = 0; e < 3; e++) {
              const u = tri[e] as number;
              const w = tri[(e + 1) % 3] as number;
              const pu = P[u * 3 + axis] as number;
              const pw = P[w * 3 + axis] as number;
              if ((pu - cut) * (pw - cut) >= 0) continue;
              const t = (cut - pu) / (pw - pu);
              const got = coord(l, u) + t * (coord(l, w) - coord(l, u));
              worst = Math.max(worst, Math.abs(got - (cut - from) / span) * span);
              crossings++;
            }
        }
      }
      expect(crossings, `${id} crossings`).toBeGreaterThan(5);
      expect(worst, `${id}: worst departure from constant, metres`).toBeLessThan(0.0005);
    };
    const bandFrom = (brow[1] as number) + FOREHEAD_FROM;
    check(
      "lines.forehead",
      1,
      bandFrom,
      FOREHEAD_SPAN,
      FOREHEAD_STOPS.map((k) => bandFrom + (k / 7) * FOREHEAD_SPAN),
    );
    check(
      "lines.glabella",
      0,
      -GLABELLA_HALF,
      2 * GLABELLA_HALF,
      GLABELLA_STOPS.map((k) => -GLABELLA_HALF + (k / 7) * 2 * GLABELLA_HALF),
    );
  });

  it("put the forehead's lines 2 to 6 cm above the brows, evenly, and the furrows 2 cm apart about the midline", () => {
    const heights = FOREHEAD_STOPS.map((k) => FOREHEAD_FROM + (k / 7) * FOREHEAD_SPAN);
    expect(FOREHEAD_STOPS.length).toBeGreaterThanOrEqual(3);
    expect(FOREHEAD_STOPS.length).toBeLessThanOrEqual(5);
    for (const h of heights) {
      expect(h).toBeGreaterThan(0.015);
      expect(h).toBeLessThan(0.065);
    }
    // Not at an end stop (a line there sits where the coordinate is clamped), and evenly spaced.
    expect(FOREHEAD_STOPS.every((k) => k > 0 && k < 7)).toBe(true);
    const gaps = FOREHEAD_STOPS.slice(1).map((k, i) => k - (FOREHEAD_STOPS[i] as number));
    expect(new Set(gaps).size).toBe(1);
    const xs = GLABELLA_STOPS.map((k) => -GLABELLA_HALF + (k / 7) * 2 * GLABELLA_HALF);
    expect(xs).toHaveLength(2);
    expect((xs[0] as number) + (xs[1] as number)).toBeCloseTo(0, 9);
    expect((xs[1] as number) - (xs[0] as number)).toBeGreaterThan(0.015);
    expect((xs[1] as number) - (xs[0] as number)).toBeLessThan(0.025);
  });

  it("hold a line's shade only at its stops, and leave the rest as the skin is", () => {
    for (const [id, stops] of [
      ["lines.forehead", FOREHEAD_STOPS],
      ["lines.glabella", GLABELLA_STOPS],
    ] as const) {
      const p = layer(id).paint(input({ "face.browRaise": 1, "face.browFurrow": 1 }, 60));
      if (!("stops" in p)) throw new Error(`${id} paints no colour stops`);
      expect(p.stops).toHaveLength(8);
      p.stops.forEach((c, k) => {
        if (stops.includes(k)) expect(c[0] as number, `${id} stop ${k}`).toBeLessThan(0.85);
        else expect(c, `${id} stop ${k}`).toEqual([1, 1, 1]);
      });
    }
  });

  it("are deepest at the forehead's centre, weaker toward the temples", () => {
    const f = index("lines.forehead");
    const at = (lo: number, hi: number) => {
      const m: number[] = [];
      for (let v = 0; v < BODY; v++) {
        const x = Math.abs(P[v * 3] as number);
        if (x >= lo && x < hi && mask(f, v) > 0.02) m.push(mask(f, v));
      }
      return m.reduce((a, b) => a + b, 0) / Math.max(1, m.length);
    };
    expect(at(0, 0.015)).toBeGreaterThan(at(0.04, 0.066));
  });
});
