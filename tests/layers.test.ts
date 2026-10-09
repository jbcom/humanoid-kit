import { describe, expect, it } from "vitest";
import { groupFaces } from "../src/format/assetFormat.ts";
import {
  applyLayers,
  buildLayerFields,
  creaseHeight,
  layerUsesCoordinate,
  paintStopTable,
  type SkinLayer,
  type SkinPaintInput,
  STOP_COUNT,
  STOP_TABLE_WIDTH,
  surfaceChange,
  uvScale,
} from "../src/surface/layers.ts";
import { SKIN_LAYER_TARGETS, SKIN_LAYERS } from "../src/surface/regions/index.ts";
import { AREOLA_REACH } from "../src/surface/regions/torso.ts";
import { areolaAlbedo, lipAlbedo, type Rgb, skinAlbedo } from "../src/surface/skinTone.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const input = (over: Partial<SkinPaintInput> = {}): SkinPaintInput => ({
  tone: { melanin: 0.6, haemoglobin: 0.5, undertone: 0, override: null },
  flush: 0.4,
  lips: 0.5,
  areola: 0.5,
  signals: {},
  ...over,
});

describe("the rest layers' fields", () => {
  const assets = loadFixtureAssets();
  const n = assets.manifest.vertexCount;
  const fields = buildLayerFields(assets, SKIN_LAYERS);
  const P = assets.positions;
  const strong = (id: string) => {
    const l = SKIN_LAYERS.findIndex((x) => x.id === id);
    const ys: number[] = [];
    const xs: number[] = [];
    for (let v = 0; v < n; v++) {
      if ((fields[(l * n + v) * 3] as number) > 0.8) {
        xs.push(P[v * 3] as number);
        ys.push(P[v * 3 + 1] as number);
      }
    }
    return {
      count: ys.length,
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      maxAbsX: Math.max(...xs.map(Math.abs)),
    };
  };

  it("find the lips at the mouth and nowhere else", () => {
    const lips = strong("lips");
    expect(lips.count).toBeGreaterThan(20);
    // The mouth sits roughly 0.62–0.66 m above the base mesh origin and is narrow.
    expect(lips.minY).toBeGreaterThan(0.6);
    expect(lips.maxY).toBeLessThan(0.68);
    expect(lips.maxAbsX).toBeLessThan(0.04);
  });

  it("find nipples and areolae on the chest, one each side", () => {
    const areola = strong("areola");
    expect(areola.count).toBeGreaterThan(10);
    expect(areola.minY).toBeGreaterThan(0.3);
    expect(areola.maxY).toBeLessThan(0.5);
    expect(areola.maxAbsX).toBeGreaterThan(0.05);
  });

  it("fill the areola, nipple included, rather than drawing its rim", () => {
    const l = SKIN_LAYERS.findIndex((x) => x.id === "areola");
    const mask = (v: number) => fields[(l * n + v) * 3] as number;
    for (const side of [1, -1]) {
      // The vertices the nipple-size target moves on this side, and their centre.
      const t = assets.targets.get("breast/nipple-size-incr");
      if (!t) throw new Error("no nipple target");
      const vs = [...t.indices].filter((v) => Math.sign(P[v * 3] as number) === side);
      const c = [0, 1, 2].map(
        (k) => vs.reduce((s, v) => s + (P[v * 3 + k] as number), 0) / vs.length,
      );
      const dist = (v: number) =>
        Math.hypot(...[0, 1, 2].map((k) => (P[v * 3 + k] as number) - (c[k] as number)));
      const r = Math.max(...vs.map(dist));
      // Everything well inside the outline is fully coloured; far outside, nothing.
      for (let v = 0; v < n; v++) {
        if (dist(v) < r * 0.6) expect(mask(v), `vertex ${v} inside`).toBeGreaterThan(0.95);
        if (dist(v) > AREOLA_REACH && dist(v) < r * 4)
          expect(mask(v), `vertex ${v} outside`).toBe(0);
      }
    }
  });

  it("keep every value in [0, 1] and name every target they need", () => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const v of fields) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
    for (const t of SKIN_LAYER_TARGETS) expect(assets.targets.has(t), t).toBe(true);
  });

  it("reject a field of the wrong length", () => {
    const bad: SkinLayer = {
      id: "bad",
      blend: "mix",
      targets: [],
      fields: () => ({ mask: new Float32Array(3), coord: null }),
      paint: () => ({ strength: 1, stops: [[0, 0, 0]] }),
    };
    expect(() => buildLayerFields(assets, [bad])).toThrow(/one value per vertex/);
  });
});

describe("the stop table", () => {
  it("paints the rest layers with the measured lip and areola models", () => {
    const i = input();
    const table = paintStopTable(SKIN_LAYERS, i);
    expect(table.length).toBe(SKIN_LAYERS.length * STOP_TABLE_WIDTH * 4);
    const row = (id: string) => SKIN_LAYERS.findIndex((l) => l.id === id) * STOP_TABLE_WIDTH * 4;
    const stop = (id: string, k: number) =>
      Array.from(table.slice(row(id) + (k + 1) * 4, row(id) + (k + 1) * 4 + 3));
    const close = (got: number[], want: Rgb) => {
      for (let j = 0; j < 3; j++) expect(got[j]).toBeCloseTo(want[j] as number, 6);
    };
    // The lips are one colour, so every stop carries it; the areola's body is its own colour
    // (its radial profile is tested in torso.test.ts) and its outer stop the skin's.
    for (const k of [0, STOP_COUNT - 1]) close(stop("lips", k), lipAlbedo(i.tone, i.lips));
    // A multiply layer of ratios to the skin: the areola's body is its colour on that skin, the
    // outer stop leaves any skin as it is.
    const skin = skinAlbedo(i.tone);
    close(
      stop("areola", 2).map((x, c) => x * (skin[c] as number)),
      areolaAlbedo(i.tone, i.areola),
    );
    close(stop("areola", STOP_COUNT - 1), [1, 1, 1]);
    expect(table[row("flush")]).toBeCloseTo(0.4, 6);
    expect(table[row("flush") + 1]).toBe(1); // multiply
    expect(table[row("lips") + 1]).toBe(0); // mix
  });

  it("resamples a gradient's stops evenly along the coordinate", () => {
    const ramp: SkinLayer = {
      id: "ramp",
      blend: "mix",
      targets: [],
      fields: () => ({ mask: new Float32Array(0), coord: null }),
      paint: () => ({
        strength: 1,
        stops: [
          [0, 0, 0],
          [1, 1, 1],
        ],
      }),
    };
    const table = paintStopTable([ramp], input());
    for (let k = 0; k < STOP_COUNT; k++)
      expect(table[(k + 1) * 4]).toBeCloseTo(k / (STOP_COUNT - 1), 6);
    expect(() =>
      paintStopTable([{ ...ramp, paint: () => ({ strength: 1, stops: [] }) }], input()),
    ).toThrow(/1 to 8 stops/);
  });
});

describe("applyLayers", () => {
  it("reproduces the fixed three-channel blend it replaces", () => {
    const i = input({ flush: 0.7 });
    const table = paintStopTable(SKIN_LAYERS, i);
    const base: Rgb = [0.3, 0.15, 0.1];
    const lip = lipAlbedo(i.tone, i.lips);
    const areola = areolaAlbedo(i.tone, i.areola);
    const tint: Rgb = [1.1, 0.84, 0.84];
    const mix = (a: number, b: number, t: number) => a + (b - a) * t;
    const [mf, ml, ma] = [0.5, 0.3, 0.2];
    const skin = skinAlbedo(i.tone);
    // The old shader: flush tint, then lips, then the areola (now a multiply by its ratio to the skin).
    const expected = base.map((c, k) => {
      let x = mix(c, c * (tint[k] as number), mf * 0.7);
      x = mix(x, lip[k] as number, ml * 0.9);
      return mix(x, x * ((areola[k] as number) / (skin[k] as number)), ma);
    });
    // The areola's coordinate 0.4 is its body, 11 mm from the nipple's centre.
    const got = applyLayers(base, table, [
      [mf, 0],
      [ml, 0],
      [ma, 0.4],
    ]);
    for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(expected[k] as number, 6);
  });

  it("leaves the skin untouched where every mask is zero", () => {
    const table = paintStopTable(SKIN_LAYERS, input({ flush: 1 }));
    expect(
      applyLayers([0.2, 0.1, 0.05], table, [
        [0, 0],
        [0, 1],
        [0, 0.5],
      ]),
    ).toEqual([0.2, 0.1, 0.05]);
  });
});

describe("detail and surface layers", () => {
  const none = () => ({ mask: new Float32Array(0), coord: null });
  const bumps: SkinLayer = {
    id: "goosebumps",
    kind: "detail",
    pattern: "bumps",
    targets: [],
    fields: none,
    paint: ({ signals }) => ({ strength: signals.cold ?? 0, height: 0.00018, size: 0.002 }),
  };
  const creases: SkinLayer = {
    id: "creases",
    kind: "detail",
    pattern: "creases",
    targets: [],
    fields: none,
    paint: () => ({ strength: 1, height: 0.0005, size: 6 }),
  };
  const sheen: SkinLayer = {
    id: "sheen",
    kind: "surface",
    targets: [],
    fields: none,
    paint: ({ signals }) => ({ strength: signals.exertion ?? 0, roughness: -0.3, specular: 0.4 }),
  };
  const stack = [bumps, creases, sheen];

  it("encode their kind and parameters in the header, driven by the signals", () => {
    const table = paintStopTable(stack, input({ signals: { cold: 0.5, exertion: 1 } }));
    const head = (l: number) =>
      Array.from(table.slice(l * STOP_TABLE_WIDTH * 4, l * STOP_TABLE_WIDTH * 4 + 4));
    expect(head(0).map((x) => Number(x.toFixed(6)))).toEqual([0.5, 2, 0.00018, 0.002]);
    expect(head(1).map((x) => Number(x.toFixed(6)))).toEqual([1, 3, 0.0005, 6]);
    expect(head(2).map((x) => Number(x.toFixed(6)))).toEqual([1, 4, -0.3, 0.4]);
    expect(() =>
      paintStopTable(
        [{ ...bumps, paint: () => ({ strength: 1, height: 0.001, size: 0 }) }],
        input(),
      ),
    ).toThrow(/size > 0/);
  });

  it("carry an amplitude profile along the coordinate in the stops, and read the coordinate only then", () => {
    const profiled: SkinLayer = {
      id: "profiled",
      kind: "detail",
      pattern: "bumps",
      profiled: true,
      targets: [],
      fields: none,
      paint: () => ({
        strength: 0.8,
        height: 0.0002,
        size: 0.001,
        profile: [1, 0.5, 0],
      }),
    };
    const tubercles: SkinLayer = {
      id: "tubercles",
      kind: "detail",
      pattern: "tubercles",
      targets: [],
      fields: none,
      paint: () => ({ strength: 1, height: 0.0006, size: 0.0022, profile: [0, 0.2] }),
    };
    const table = paintStopTable([profiled, tubercles], input());
    const row = (l: number) => l * STOP_TABLE_WIDTH * 4;
    // Kind 6 is bumps with a profile, 7 tubercles (whose occupancy is the profile).
    expect(table[row(0) + 1]).toBe(6);
    expect(table[row(1) + 1]).toBe(7);
    // The profile is resampled evenly over the stops, in the red channel, as colour stops are.
    const red = (l: number) =>
      Array.from({ length: STOP_COUNT }, (_, k) => table[row(l) + (k + 1) * 4] as number);
    expect(red(0)[0]).toBeCloseTo(1, 6);
    expect(red(0)[STOP_COUNT - 1]).toBeCloseTo(0, 6);
    expect(red(0)[Math.floor((STOP_COUNT - 1) / 2)]).toBeGreaterThan(0.4);
    expect(red(1)[0]).toBeCloseTo(0, 6);
    expect(red(1)[STOP_COUNT - 1]).toBeCloseTo(0.2, 6);
    expect(layerUsesCoordinate(profiled)).toBe(true);
    expect(layerUsesCoordinate(tubercles)).toBe(true);
    expect(layerUsesCoordinate(bumps)).toBe(false);
    // A profile outside 0..1, or empty, is a mistake, and so is one a layer did not declare.
    const bad = (profile: number[]): SkinLayer => ({
      ...profiled,
      paint: () => ({ strength: 1, height: 0.001, size: 0.001, profile }),
    });
    expect(() => paintStopTable([bad([1.5])], input())).toThrow(/profile/);
    expect(() => paintStopTable([bad([])], input())).toThrow(/profile/);
    expect(() => paintStopTable([bad(Array(STOP_COUNT + 1).fill(1))], input())).toThrow(/profile/);
    const undeclared: SkinLayer = {
      ...bumps,
      paint: () => ({ strength: 1, height: 0.001, size: 0.001, profile: [1] }),
    };
    expect(() => paintStopTable([undeclared], input())).toThrow(/profile/);
    const missing: SkinLayer = {
      ...profiled,
      paint: () => ({ strength: 1, height: 0.001, size: 0.001 }),
    };
    expect(() => paintStopTable([missing], input())).toThrow(/profile/);
  });

  it("carry a mark's colour ratio and amount in the stops, for a striae layer", () => {
    const striae: SkinLayer = {
      id: "striae",
      kind: "detail",
      pattern: "striae",
      targets: [],
      fields: none,
      paint: () => ({
        strength: 0.9,
        height: 0.00015,
        size: 0.005,
        striae: { amount: 0.6, ratio: [0.9, 0.7, 0.75] },
      }),
    };
    const table = paintStopTable([striae], input());
    const head = Array.from(table.slice(0, 4)).map((x) => Number(x.toFixed(6)));
    expect(head).toEqual([0.9, 8, 0.00015, 0.005]);
    // Stop 0 is the ratio, stop 1 the amount.
    expect(Array.from(table.slice(4, 8)).map((x) => Number(x.toFixed(6)))).toEqual([
      0.9, 0.7, 0.75, 1,
    ]);
    expect(Array.from(table.slice(8, 12)).map((x) => Number(x.toFixed(6)))).toEqual([0.6, 0, 0, 1]);
    expect(layerUsesCoordinate(striae)).toBe(true);
    const bad = (striaePaint: object | undefined): SkinLayer => ({
      ...striae,
      paint: () => ({
        strength: 1,
        height: 0.0001,
        size: 0.005,
        ...(striaePaint && {
          striae: striaePaint as { amount: number; ratio: [number, number, number] },
        }),
      }),
    });
    expect(() => paintStopTable([bad(undefined)], input())).toThrow(/striae/);
    expect(() => paintStopTable([bad({ amount: 1.5, ratio: [1, 1, 1] })], input())).toThrow(
      /striae/,
    );
    expect(() => paintStopTable([bad({ amount: 0.5, ratio: [1, -1, 1] })], input())).toThrow(
      /striae/,
    );
    // Another pattern may not carry one.
    const stray: SkinLayer = {
      ...bumps,
      paint: () => ({
        strength: 1,
        height: 0.001,
        size: 0.002,
        striae: { amount: 1, ratio: [1, 1, 1] as [number, number, number] },
      }),
    };
    expect(() => paintStopTable([stray], input())).toThrow(/striae/);
  });

  it("leave the colour alone, and surface changes add by mask and strength", () => {
    const table = paintStopTable(stack, input({ signals: { exertion: 0.5 } }));
    const fields: [number, number][] = [
      [1, 0],
      [1, 0.3],
      [0.5, 0],
    ];
    expect(applyLayers([0.3, 0.2, 0.1], table, fields)).toEqual([0.3, 0.2, 0.1]);
    const s = surfaceChange(table, fields);
    expect(s.roughness).toBeCloseTo(0.5 * 0.5 * -0.3, 6);
    expect(s.specular).toBeCloseTo(0.5 * 0.5 * 0.4, 6);
  });

  it("cut creases as narrow grooves, size of them across the coordinate, flat at its ends", () => {
    // A groove at the middle of each period, nothing at the period's ends (so a
    // layer's window, whose ends are the coordinate's, starts and ends flat).
    expect(creaseHeight(0.001, 4, 0)).toBeCloseTo(0, 9);
    expect(creaseHeight(0.001, 4, 1)).toBeCloseTo(0, 9);
    expect(creaseHeight(0.001, 4, 1 / 8)).toBeCloseTo(-0.001, 9);
    expect(creaseHeight(0.001, 4, 3 / 8)).toBeCloseTo(-0.001, 9);
    expect(creaseHeight(0.001, 4, 1 / 4)).toBeCloseTo(0, 9);
    // Narrower than a cosine, which would be half as deep a quarter of a period in.
    expect(creaseHeight(0.001, 4, 1 / 16)).toBeGreaterThan(-0.0002);
    expect(creaseHeight(0.001, 4, 1 / 16)).toBeLessThan(0);
    // Depth scales with the height.
    expect(creaseHeight(0.004, 4, 1 / 8)).toBeCloseTo(-0.004, 9);
  });

  it("measure the body's UV scale in metres per UV unit, positive where the body is", () => {
    const assets = loadFixtureAssets();
    const faces = groupFaces(assets, "body");
    const s = uvScale(assets, faces);
    const onBody = new Set<number>();
    for (const f of faces)
      for (let k = 0; k < 4; k++) onBody.add(assets.faceVerts[f * 4 + k] as number);
    const values = [...onBody].map((v) => s[v] as number);
    // The figure is about 1.7 m tall on a 0..1 UV square: around a metre or two per unit.
    const median = values.sort((a, b) => a - b)[values.length >> 1] as number;
    expect(median).toBeGreaterThan(0.5);
    expect(median).toBeLessThan(5);
    expect(values.every((x) => x > 0 && Number.isFinite(x))).toBe(true);
  });
});

describe("the UV scale and the relief coordinate built from it", () => {
  const assets = loadFixtureAssets();
  const faces = groupFaces(assets, "body");
  const scale = uvScale(assets, faces);
  const P = assets.positions;
  const U = assets.uvs;

  /** The UV island (connected faces sharing UV vertices) of each body face. */
  const islands = (() => {
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      let r = x;
      while ((parent.get(r) ?? r) !== r) r = parent.get(r) as number;
      parent.set(x, r);
      return r;
    };
    for (const f of faces)
      for (let k = 1; k < 4; k++) {
        const a = find(assets.faceUvs[f * 4] as number);
        const b = find(assets.faceUvs[f * 4 + k] as number);
        if (a !== b) parent.set(a, b);
      }
    return new Map([...faces].map((f) => [f, find(assets.faceUvs[f * 4] as number)]));
  })();

  it("is one value for a whole UV island, away from its seams", () => {
    // A vertex's islands: a seam vertex belongs to two, and takes a blend.
    const of = new Map<number, Set<number>>();
    for (const f of faces)
      for (let k = 0; k < 4; k++) {
        const v = assets.faceVerts[f * 4 + k] as number;
        if (!of.has(v)) of.set(v, new Set());
        of.get(v)?.add(islands.get(f) as number);
      }
    const perIsland = new Map<number, number[]>();
    for (const [v, set] of of)
      if (set.size === 1) {
        const id = [...set][0] as number;
        if (!perIsland.has(id)) perIsland.set(id, []);
        perIsland.get(id)?.push(scale[v] as number);
      }
    expect(perIsland.size).toBeGreaterThanOrEqual(5);
    for (const [id, values] of perIsland) {
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      expect(hi - lo, `island ${id}`).toBeLessThan(1e-4);
    }
  });

  it("gives a seam vertex the plain mean of its islands, however many faces each has there", () => {
    const of = new Map<number, Set<number>>();
    for (const f of faces)
      for (let k = 0; k < 4; k++) {
        const v = assets.faceVerts[f * 4 + k] as number;
        if (!of.has(v)) of.set(v, new Set());
        of.get(v)?.add(islands.get(f) as number);
      }
    // An island's own scale: the value at any of its vertices in no other island.
    const own = new Map<number, number>();
    for (const [v, set] of of)
      if (set.size === 1) own.set([...set][0] as number, scale[v] as number);
    let seams = 0;
    for (const [v, set] of of) {
      if (set.size < 2 || ![...set].every((id) => own.has(id))) continue;
      const mean = [...set].reduce((s, id) => s + (own.get(id) as number), 0) / set.size;
      expect(scale[v] as number, `vertex ${v}`).toBeCloseTo(mean, 4);
      seams++;
    }
    expect(seams).toBeGreaterThan(20);
  });

  it("makes the relief coordinate uv × scale an undistorted map of the skin", () => {
    // Relief is drawn at p = uv × scale (metres), interpolated over each face. If the
    // scale varied across a face, uv × scale would stretch and shear p against the
    // surface: bumps become streaks. Measure that map's singular values per triangle.
    const ratios: number[] = [];
    for (const f of faces) {
      const v = [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number);
      const t = [0, 1, 2, 3].map((k) => assets.faceUvs[f * 4 + k] as number);
      for (const tri of [
        [0, 1, 2],
        [0, 2, 3],
      ] as const) {
        const [a, b, c] = tri;
        const pos = (i: number) => [0, 1, 2].map((k) => P[(v[i] as number) * 3 + k] as number);
        const p = (i: number) =>
          [0, 1].map(
            (k) => (U[(t[i] as number) * 2 + k] as number) * (scale[v[i] as number] as number),
          );
        const e1 = pos(b).map((x, k) => x - (pos(a)[k] as number));
        const e2 = pos(c).map((x, k) => x - (pos(a)[k] as number));
        const d1 = p(b).map((x, k) => x - (p(a)[k] as number));
        const d2 = p(c).map((x, k) => x - (p(a)[k] as number));
        // The surface's metric in p: Gram matrix of the images of e1, e2 inverted.
        const g11 = e1.reduce((s, x) => s + x * x, 0);
        const g12 = e1.reduce((s, x, i) => s + x * (e2[i] as number), 0);
        const g22 = e2.reduce((s, x) => s + x * x, 0);
        const det = (d1[0] as number) * (d2[1] as number) - (d1[1] as number) * (d2[0] as number);
        if (Math.abs(det) < 1e-14) continue;
        // M maps (e1, e2) coordinates to p; singular values of p's per-metre derivative.
        const inv = [
          [(d2[1] as number) / det, -(d2[0] as number) / det],
          [-(d1[1] as number) / det, (d1[0] as number) / det],
        ] as const;
        // dsurface/dp = [e1 e2] · inv; its Gram matrix G' = invᵀ [g] inv.
        const gp = [0, 1].map((i) =>
          [0, 1].map((j) => {
            let s = 0;
            const g = [
              [g11, g12],
              [g12, g22],
            ] as const;
            for (let m = 0; m < 2; m++)
              for (let n = 0; n < 2; n++)
                s += (inv[m]?.[i] as number) * (g[m]?.[n] as number) * (inv[n]?.[j] as number);
            return s;
          }),
        );
        const [[e, ff], [, gg]] = gp as [[number, number], [number, number]];
        const tr = e + gg;
        const disc = Math.sqrt(Math.max(0, (e - gg) ** 2 + 4 * ff * ff));
        ratios.push(Math.sqrt((tr + disc) / 2) / Math.sqrt(Math.max(1e-30, (tr - disc) / 2)));
      }
    }
    ratios.sort((x, y) => x - y);
    const at = (q: number) => ratios[Math.floor(q * (ratios.length - 1))] as number;
    // The UV layout itself stretches up to about 1.5× on the limbs (see below);
    // anything near 5× is the coordinate's doing.
    expect(at(0.5)).toBeLessThan(1.6);
    expect(at(0.95)).toBeLessThan(2.5);
  });
});

describe("a layer's paint is told the figure's age", () => {
  it("passes the age in years through the stop table, absent when none is given", () => {
    const seen: (number | undefined)[] = [];
    const layer: SkinLayer = {
      id: "age-probe",
      blend: "mix",
      targets: [],
      fields: () => ({ mask: new Float32Array(0), coord: null }),
      paint: (input) => {
        seen.push(input.age);
        return { strength: 1, stops: [[0.5, 0.4, 0.3]] };
      },
    };
    const base = {
      tone: { melanin: 0.5, haemoglobin: 0.5, undertone: 0, override: null },
      flush: 0.4,
      lips: 0.5,
      areola: 0.5,
      signals: {},
    };
    paintStopTable([layer], { ...base, age: 72 });
    paintStopTable([layer], base);
    expect(seen).toEqual([72, undefined]);
  });
});
