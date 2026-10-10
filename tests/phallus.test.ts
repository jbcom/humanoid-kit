import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { describe, expect, it } from "vitest";
import { AUTHORING_FIGURE } from "../scripts/lib/control/mound.ts";
import { skinOf } from "../scripts/lib/detail/contact.ts";
import { sweep } from "../scripts/lib/detail/form.ts";
import {
  DORSAL,
  dorsalLength,
  GIRTH_RANGE,
  keyShape,
  LENGTH_RANGE,
  PHALLUS_GIRTH,
  PHALLUS_KEYS,
  PHALLUS_LENGTH,
  PHALLUS_SIZE,
  phallusTargets,
  STATES,
  SculptedPhallus,
  type Variation,
} from "../scripts/lib/detail/phallus.ts";
import { type ReservoirRoot, type RootShape, reservoirRoot } from "../scripts/lib/detail/root.ts";
import { maleParts } from "../scripts/lib/detail/sculpt.ts";
import { skirtOnto } from "../scripts/lib/detail/transfer.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { AgePolicyError } from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

/**
 * The phallic organ (scripts/lib/detail/phallus.ts): the CC0 sculpt's shaft and
 * glans projected onto the reservoir, sized to the measured length, girth and
 * growth of the literature (docs/research/ADULT-ANATOMY-DATA.md, section F). The
 * projection is held to the sculpt, the sized shapes to those numbers, and the
 * surface a figure gets to the generator's shape for every variant it can ask for.
 */
const assets = loadFixtureAssets(true);
const model = new HumanoidModel(assets, { subdivision: 1 });
const lattice = model.adultDetailLattice(AUTHORING_FIGURE);
if (!lattice) throw new Error("no adult surface");
const spec = adultManifest.anatomy?.reservoirs?.find((r) => r.id === "phallic");
if (!spec) throw new Error("no phallic reservoir");
const root: ReservoirRoot = reservoirRoot(lattice, spec);
const LOOP = root.loop.length;

/** Extent (hi - lo) per axis of a set of points. */
function span(points: Iterable<readonly number[]>): number[] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k] as number, p[k] as number);
      hi[k] = Math.max(hi[k] as number, p[k] as number);
    }
  return lo.map((l, k) => (hi[k] as number) - l);
}

const DEFAULT = PHALLUS_KEYS[2];
if (!DEFAULT) throw new Error("no default key");
const parts = maleParts(assets, model.controlShape(AUTHORING_FIGURE).control);
const skin = skinOf(lattice, (adultManifest.anatomy?.reservoirs ?? []).map((r) => r.cap));
const organ = new SculptedPhallus(root, parts.phallus, skin);

describe("the sculpt on the reservoir", () => {
  it("lies on the sculpted part and its skirt, and the glans is the sculpt's own", () => {
    const distances = (surface: { positions: Float64Array; triangles: Uint32Array }) => {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(Float32Array.from(surface.positions), 3));
      geometry.setIndex(new BufferAttribute(surface.triangles, 1));
      const bvh = new MeshBVH(geometry);
      const hit = { point: new Vector3(), distance: 0, faceIndex: 0 };
      return organ.projected.map((p) => {
        bvh.closestPointToPoint(new Vector3(p[0], p[1], p[2]), hit);
        return hit.distance;
      });
    };
    const { skirted } = skirtOnto(root, parts.phallus, { reference: DORSAL });
    // Every vertex reads the skirted part (to single precision).
    expect(Math.max(...distances(skirted))).toBeLessThan(1e-5);
    // The cap and the last fifth of the rings, the glans, are on the sculpt itself.
    const onSculpt = distances(parts.phallus);
    const glans = onSculpt.filter(
      (_, i) => i < root.cap.length || i >= root.cap.length + Math.floor(0.8 * root.rings) * LOOP,
    );
    expect(Math.max(...glans)).toBeLessThan(1e-5);
  });

  it("is its own form swept back unchanged: the form keeps the shape exactly", () => {
    const back = sweep(organ.form, { blend: 0.01 });
    organ.projected.forEach((p, i) => {
      const q = back[i] as readonly number[];
      for (let k = 0; k < 3; k++) expect(q[k] as number).toBeCloseTo(p[k] as number, 9);
    });
  });
});

describe("the organ's shape against the literature", () => {
  const flaccid = keyShape(organ, DEFAULT);
  const erect = keyShape(organ, DEFAULT, { state: 1 });

  it("is as long as the default key says: Veale's pooled flaccid length, 9.16 cm, along the top", () => {
    expect(dorsalLength(root, flaccid)).toBeCloseTo(0.0916, 4);
  });

  it("is as round as the default key says: Veale's pooled flaccid circumference, 9.31 cm at mid-shaft", () => {
    expect(organ.girthOf(flaccid)).toBeCloseTo(0.0931, 4);
  });

  it("erects by the measured growth: length +43% and circumference +25% (13.12 / 9.16, 11.66 / 9.31)", () => {
    expect(dorsalLength(root, erect) / dorsalLength(root, flaccid)).toBeCloseTo(13.12 / 9.16, 3);
    expect(organ.girthOf(erect) / organ.girthOf(flaccid)).toBeCloseTo(11.66 / 9.31, 3);
  });

  it("varies by two standard deviations of length and girth at a full step", () => {
    const long = keyShape(organ, DEFAULT, { length: 1 + LENGTH_RANGE });
    const thick = keyShape(organ, DEFAULT, { girth: 1 + GIRTH_RANGE });
    expect(dorsalLength(root, long)).toBeCloseTo(0.0916 + 2 * 0.0157, 4);
    expect(organ.girthOf(thick)).toBeCloseTo(0.0931 + 2 * 0.009, 4);
  });

  it("rises when erect and hangs when flaccid", () => {
    const tipAt = (shape: RootShape) => {
      // The cap vertex farthest from the root along the organ.
      let best = shape[0] as readonly number[];
      let far = 0;
      for (let k = 0; k < root.cap.length; k++) {
        const p = shape[k] as readonly number[];
        const d = Math.hypot((p[1] as number) - root.centre[1], (p[2] as number) - root.centre[2]);
        if (d > far) {
          far = d;
          best = p;
        }
      }
      return best;
    };
    const f = tipAt(flaccid);
    const e = tipAt(erect);
    expect(f[1] as number).toBeLessThan(root.centre[1] - 0.05);
    expect(e[1] as number).toBeGreaterThan(root.centre[1]);
    expect(e[2] as number).toBeGreaterThan(f[2] as number);
  });

  it("grows with size through the sculpted keys to the measured length and girth of each", () => {
    for (const key of PHALLUS_KEYS.filter((k) => k.form === "sculpt")) {
      const shape = keyShape(organ, key);
      expect(dorsalLength(root, shape), `${key.size}`).toBeCloseTo(key.length, 4);
      // Within 2%: where mid-shaft falls moves with the length, so the girth is fitted to a step.
      expect(Math.abs(organ.girthOf(shape) / key.circumference - 1), `${key.size}`).toBeLessThan(
        0.02,
      );
    }
    // The drawn clitoral key is smaller than the smallest sculpted one.
    const glans = PHALLUS_KEYS[0] as (typeof PHALLUS_KEYS)[number];
    const small = PHALLUS_KEYS[1] as (typeof PHALLUS_KEYS)[number];
    expect(span(keyShape(organ, glans))[1] as number).toBeLessThan(
      span(keyShape(organ, small))[1] as number,
    );
  });

  it("has only finite positions, for every key and variation", () => {
    for (const key of PHALLUS_KEYS)
      for (const v of [
        {},
        { state: 0.5 },
        { state: 1 },
        { length: 1 + LENGTH_RANGE },
        { girth: 1 - GIRTH_RANGE, state: 1 },
      ])
        for (const p of keyShape(organ, key, v)) expect(p.every(Number.isFinite)).toBe(true);
  });

  it("keeps the loop where the skin is: a ring's first vertices stay near the root", () => {
    // Ring 1 is a sliver off the loop, not a jump.
    const g = flaccid;
    for (let i = 0; i < LOOP; i++) {
      const p = g[root.cap.length + i] as readonly number[];
      const q = root.loop[i] as readonly number[];
      expect(Math.hypot(...[0, 1, 2].map((k) => (p[k] as number) - (q[k] as number)))).toBeLessThan(
        0.012,
      );
    }
  });
});

describe("the pack's organ", () => {
  const detail = adultManifest.anatomy?.detail;

  it("names its targets, all driven, on the lattice they were authored on", () => {
    if (!detail) throw new Error("the pack has no detail");
    expect(detail.surfaceKey).toBe(lattice.key);
    expect(Object.keys(detail.drives ?? {}).sort()).toEqual([...detail.targets].sort());
    // The organ's targets come first; the sacs' follow (scrotum.test.ts).
    const names = phallusTargets(root, parts.phallus, skin).targets.map((t) => t.name);
    expect(detail.targets.slice(0, names.length)).toEqual(names);
  });

  it("is read by the arousal signal and by nothing in the body's own state morphs", () => {
    expect(adultManifest.anatomy?.stateMorphs).toEqual([]);
    const erectDrives = Object.entries(detail?.drives ?? {}).filter(([, f]) =>
      f.some((x) => x.startsWith("sramp:arousal:")),
    );
    expect(erectDrives.length).toBeGreaterThan(0);
    const suffix = new RegExp(`-(${STATES.map((s) => s.name).join("|")})$`);
    for (const [name] of erectDrives) expect(name).toMatch(suffix);
    // Every key that erects is drawn at every state, with its variations.
    const erecting = PHALLUS_KEYS.filter((k) => k.erects).length;
    expect(erectDrives.length).toBe(erecting * STATES.length * 5);
  });

  it("offers a size, a length and a girth, all adult-only and none with a target of its own", () => {
    for (const id of [PHALLUS_SIZE, PHALLUS_LENGTH, PHALLUS_GIRTH]) {
      const m = adultManifest.modifiers.find((x) => x.id === id);
      expect(m, id).toBeDefined();
      expect(m?.adultOnly).toBe(true);
      expect(m?.hi).toBe("");
      expect(m?.lo === null || m?.lo === "").toBe(true);
    }
  });
});

describe("the organ on the adult surface", { timeout: 300_000 }, () => {
  const figure = (modifiers: Record<string, number> = {}) =>
    createRecipe({ macros: AUTHORING_FIGURE.macros, modifiers });
  const rest = model.evaluate(figure()).positions;
  const moved = (positions: Float32Array) => {
    const out: number[][] = [];
    for (let v = 0; v < positions.length / 3; v++) {
      let did = false;
      for (let k = 0; k < 3; k++)
        if (Math.abs((positions[v * 3 + k] as number) - (rest[v * 3 + k] as number)) > 1e-7)
          did = true;
      if (did) out.push([0, 1, 2].map((k) => positions[v * 3 + k] as number));
    }
    return out;
  };
  const surfaceSpan = (modifiers: Record<string, number>, signals: Record<string, number> = {}) =>
    span(moved(model.evaluate(figure(modifiers), signals).positions));
  const generated = (key: number, v: Variation) =>
    span(keyShape(organ, PHALLUS_KEYS[key] as (typeof PHALLUS_KEYS)[number], v));
  const near = (a: number[], b: number[]) => {
    for (let k = 0; k < 3; k++) expect(a[k], `axis ${k}`).toBeCloseTo(b[k] as number, 3);
  };

  it("draws nothing at size 0, whatever the length, girth or arousal", () => {
    expect(moved(model.evaluate(figure()).positions)).toHaveLength(0);
    expect(
      moved(
        model.evaluate(figure({ [PHALLUS_LENGTH]: 1, [PHALLUS_GIRTH]: -1 }), { arousal: 1 })
          .positions,
      ),
    ).toHaveLength(0);
  });

  it("is the generator's shape at each key's size: the pipeline keeps what was authored", () => {
    PHALLUS_KEYS.forEach((key, k) => {
      near(surfaceSpan({ [PHALLUS_SIZE]: key.size }), generated(k, {}));
    });
  });

  it("is the generator's shape for every variation a key offers, erect ones too", () => {
    const k = 2;
    const size = { [PHALLUS_SIZE]: (PHALLUS_KEYS[k] as { size: number }).size };
    near(surfaceSpan({ ...size, [PHALLUS_LENGTH]: 1 }), generated(k, { length: 1 + LENGTH_RANGE }));
    near(
      surfaceSpan({ ...size, [PHALLUS_LENGTH]: -1 }),
      generated(k, { length: 1 - LENGTH_RANGE }),
    );
    near(surfaceSpan({ ...size, [PHALLUS_GIRTH]: 1 }), generated(k, { girth: 1 + GIRTH_RANGE }));
    near(surfaceSpan({ ...size, [PHALLUS_GIRTH]: -1 }), generated(k, { girth: 1 - GIRTH_RANGE }));
    // The states it erects through, each drawn, with their variations.
    for (const { state } of STATES) {
      const arousal = state;
      near(surfaceSpan(size, { arousal }), generated(k, { state }));
      near(
        surfaceSpan({ ...size, [PHALLUS_LENGTH]: 1 }, { arousal }),
        generated(k, { length: 1 + LENGTH_RANGE, state }),
      );
      near(
        surfaceSpan({ ...size, [PHALLUS_GIRTH]: -1 }, { arousal }),
        generated(k, { girth: 1 - GIRTH_RANGE, state }),
      );
    }
  });

  it("erects through its drawn states: between two a vertex is halfway, and the shaft never shortens", () => {
    const size = { [PHALLUS_SIZE]: 0.65 };
    const at = (arousal: number) => model.evaluate(figure(size), { arousal }).positions;
    const tipVertex = (() => {
      const p = at(1);
      let best = 0;
      for (let v = 1; v < p.length / 3; v++)
        if (
          Math.abs((p[v * 3 + 2] as number) - (rest[v * 3 + 2] as number)) >
          Math.abs((p[best * 3 + 2] as number) - (rest[best * 3 + 2] as number))
        )
          best = v;
      return best;
    })();
    const point = (arousal: number) =>
      [0, 1, 2].map((k) => at(arousal)[tipVertex * 3 + k] as number);
    // Halfway between two drawn states, a vertex is halfway between its places in them.
    const drawn = [0, ...STATES.map((s) => s.state)];
    for (let i = 1; i < drawn.length; i++) {
      const a = drawn[i - 1] as number;
      const b = drawn[i] as number;
      const [pa, pm, pb] = [a, (a + b) / 2, b].map(point);
      for (let k = 0; k < 3; k++)
        expect(pm?.[k]).toBeCloseTo(((pa?.[k] as number) + (pb?.[k] as number)) / 2, 5);
    }
    // The shaft keeps lengthening along the way: the dorsal length of the shape the
    // surface blends (each vertex a straight line between two drawn states) never falls by
    // more than half a millimetre, where a straight line cuts a swing's corner. (The tip's
    // straight distance from the root need not grow: the erect shaft rises in a curve
    // from a root that faces down.)
    const key = PHALLUS_KEYS[2] as (typeof PHALLUS_KEYS)[number];
    const shapes = drawn.map((state) => keyShape(organ, key, { state }));
    const blended = (a: number) => {
      const i = Math.min(drawn.length - 2, drawn.findIndex((s) => s >= a) - 1 < 0 ? 0 : drawn.findIndex((s) => s >= a) - 1);
      const s0 = drawn[i] as number;
      const s1 = drawn[i + 1] as number;
      const t = (a - s0) / (s1 - s0);
      const from = shapes[i] as RootShape;
      const to = shapes[i + 1] as RootShape;
      return from.map((p, j) => {
        const q = to[j] as readonly number[];
        return [0, 1, 2].map((k) => (p[k] as number) * (1 - t) + (q[k] as number) * t);
      }) as unknown as RootShape;
    };
    const lengths = Array.from({ length: 17 }, (_, i) => dorsalLength(root, blended(i / 16)));
    for (let i = 1; i < lengths.length; i++)
      expect(lengths[i] as number, `step ${i}`).toBeGreaterThan((lengths[i - 1] as number) - 5e-4);
    expect(lengths[16] as number).toBeGreaterThan((lengths[0] as number) * 1.4);
  });

  it("holds still for a phallus below the first erecting key", () => {
    // A phallus smaller than the first erecting key has no erect state: it holds still.
    const small = { [PHALLUS_SIZE]: (PHALLUS_KEYS[0] as { size: number }).size };
    const a = moved(model.evaluate(figure(small)).positions);
    const b = moved(model.evaluate(figure(small), { arousal: 1 }).positions);
    expect(b).toEqual(a);
  });

  it("grows smoothly between keys: more size is further out, with no jump at a key", () => {
    // How far the organ reaches down: its height from top to bottom.
    const reach = (size: number) => surfaceSpan({ [PHALLUS_SIZE]: size })[1] as number;
    let prev = 0;
    for (let s = 0.04; s <= 1.0001; s += 0.04) {
      const r = reach(s);
      // A nub on its skirt may thin by a fraction of a millimetre as it grows; it never shrinks more.
      expect(r, `size ${s}`).toBeGreaterThanOrEqual(prev - 5e-4);
      prev = r;
    }
  });

  it("refuses every one of these controls under 18, and the signal too", () => {
    const minor = (modifiers: Record<string, number>) =>
      createRecipe({ macros: { ...AUTHORING_FIGURE.macros, age: 15 }, modifiers });
    for (const id of [PHALLUS_SIZE, PHALLUS_LENGTH, PHALLUS_GIRTH])
      expect(() => model.evaluate(minor({ [id]: 0.5 })), id).toThrow(AgePolicyError);
    expect(() => model.evaluate(minor({}), { arousal: 1 })).toThrow(AgePolicyError);
  });
});
