/**
 * The authored hair styles (scripts/lib/hairCards): ropes placed from angles round the head, lying on
 * and hanging over the default figure's body, bound to its base mesh.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { beforeAll, describe, expect, it } from "vitest";
import { compileAuthored } from "../scripts/lib/hairCards/compile.ts";
import { BodySurface, HeadFrame } from "../scripts/lib/hairCards/head.ts";
import { AUTHORED_STYLES } from "../scripts/lib/hairCards/index.ts";
import type { Cards } from "../scripts/lib/hairCards/ropes.ts";
import { hairlineElevation } from "../scripts/lib/hairCards/styles.ts";
import { evaluateBinding } from "../src/mhclo/bound.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { loadHairFixtureAssets } from "./hairFixtures.ts";

let rest: ReturnType<HumanoidModel["restHead"]>;
let head: HeadFrame;
let body: BodySurface;
beforeAll(() => {
  rest = new HumanoidModel(loadHairFixtureAssets(), { subdivision: 0 }).restHead();
  head = new HeadFrame(rest);
  body = new BodySurface(rest, head);
});

describe("the head frame", () => {
  it("finds the scalp from every direction over the cranium, with the normal pointing out", () => {
    for (let az = -180; az < 180; az += 20)
      for (let el = -10; el <= 90; el += 20) {
        const s = head.surface((az * Math.PI) / 180, (el * Math.PI) / 180);
        expect(s, `azimuth ${az}, elevation ${el}`).not.toBeNull();
        if (!s) continue;
        expect(s.normal.length()).toBeCloseTo(1, 5);
        expect(s.normal.dot(new Vector3().subVectors(s.point, head.centre))).toBeGreaterThan(0);
        // On the body, not near it.
        expect(Math.abs(body.probe(s.point).distance)).toBeLessThan(1e-4);
      }
  });

  it("reads a point as outside the body above the crown and inside it under the scalp", () => {
    const crown = head.surface(0, Math.PI / 2);
    if (!crown) throw new Error("no crown");
    expect(
      body.probe(crown.point.clone().addScaledVector(crown.normal, 0.01)).distance,
    ).toBeCloseTo(0.01, 3);
    expect(
      body.probe(crown.point.clone().addScaledVector(crown.normal, -0.02)).distance,
    ).toBeLessThan(-0.01);
  });

  it("puts the hairline lowest at the nape and the front's middle higher than the temples", () => {
    expect(hairlineElevation(180)).toBeLessThan(hairlineElevation(0));
    expect(hairlineElevation(40)).toBeLessThan(hairlineElevation(0));
    expect(hairlineElevation(-40)).toBe(hairlineElevation(40));
  });
});

/** Each rope's vertices: a rope is one tube, from its first ring (a run of `roots`) to the next one's. */
function ropeRuns(cards: Cards): { first: number; last: number }[] {
  const starts: number[] = [];
  for (let i = 0; i < cards.roots.length; i++)
    if (i === 0 || cards.roots[i] !== (cards.roots[i - 1] as number) + 1)
      starts.push(cards.roots[i] as number);
  const end = cards.positions.length / 3;
  return starts.map((first, k) => ({ first, last: (starts[k + 1] ?? end) - 1 }));
}

describe.each([
  ["braids01", 100, 200, 0.9],
  ["locs01", 40, 80, 0.85],
  ["twists01", 100, 250, 0.85],
] as const)("the rope grid %s", (id, fewest, most, crownCover) => {
  let cards: Cards;
  beforeAll(() => {
    const spec = AUTHORED_STYLES.find((s) => s.id === id);
    if (!spec) throw new Error(`no ${id}`);
    cards = spec.build({ head, body });
  });

  it(`parts the head into ${fewest} to ${most} sections, one rope each`, () => {
    const n = ropeRuns(cards).length;
    expect(n).toBeGreaterThanOrEqual(fewest);
    expect(n).toBeLessThanOrEqual(most);
  });

  it("covers the crown: no bare starburst of partings where the ropes leave the top of the head", () => {
    // Looking in at the scalp from outside, along the direction from the skull's centre: from 50
    // degrees of elevation up, nearly every look meets a rope before the scalp.
    const tris: number[] = [];
    for (let f = 0; f < cards.faceVerts.length; f += 4) {
      const q = cards.faceVerts.slice(f, f + 4) as [number, number, number, number];
      tris.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(cards.positions), 3));
    geometry.setIndex(tris);
    const bvh = new MeshBVH(geometry);
    let looks = 0;
    let covered = 0;
    for (let az = -180; az < 180; az += 4)
      for (let el = 50; el <= 88; el += 3) {
        const scalp = head.surface((az * Math.PI) / 180, (el * Math.PI) / 180);
        if (!scalp) continue;
        const out = new Vector3().subVectors(scalp.point, head.centre).normalize();
        const from = scalp.point.clone().addScaledVector(out, 0.3);
        const hit = bvh.raycastFirst(new Ray(from, out.negate()), DoubleSide);
        looks++;
        if (hit && hit.distance < 0.299) covered++;
      }
    expect(covered / looks).toBeGreaterThanOrEqual(crownCover);
  });

  if (id !== "twists01")
    it("drapes: the ropes from the sides and the lower rows come to rest on the shoulders, neck and back", () => {
      // (The crown's ropes are the outer layer: combed back, they hang over these, and with no
      // rope-on-rope contact modelled, a little way off the back.)
      const at = (v: number) =>
        new Vector3(
          cards.positions[v * 3] as number,
          cards.positions[v * 3 + 1] as number,
          cards.positions[v * 3 + 2] as number,
        );
      let lower = 0;
      let resting = 0;
      for (const { first, last } of ropeRuns(cards)) {
        const out = at(first).sub(head.centre).normalize();
        if (Math.asin(out.y) > (45 * Math.PI) / 180) continue;
        lower++;
        if (body.probe(at(last)).distance < 0.025) resting++;
      }
      expect(resting / lower).toBeGreaterThanOrEqual(0.8);
    });
});

describe("bantu knots", () => {
  /**
   * Each knot: a knot is one tube, from its first ring (a run of `roots`) to the next knot's; its
   * root is the centre of that ring.
   */
  function knots(cards: Cards): { root: Vector3; points: Vector3[] }[] {
    const runs: number[][] = [];
    for (let i = 0; i < cards.roots.length; i++) {
      const v = cards.roots[i] as number;
      if (i === 0 || v !== (cards.roots[i - 1] as number) + 1) runs.push([]);
      (runs[runs.length - 1] as number[]).push(v);
    }
    const end = cards.positions.length / 3;
    const at = (v: number) =>
      new Vector3(
        cards.positions[v * 3] as number,
        cards.positions[v * 3 + 1] as number,
        cards.positions[v * 3 + 2] as number,
      );
    return runs.map((ring, k) => {
      const first = ring[0] as number;
      const last = ((runs[k + 1] as number[] | undefined)?.[0] ?? end) - 1;
      const points: Vector3[] = [];
      for (let v = first; v <= last; v++) points.push(at(v));
      const root = new Vector3();
      for (const v of ring) root.add(at(v));
      return { root: root.divideScalar(ring.length), points };
    });
  }
  let all: { root: Vector3; points: Vector3[] }[];
  beforeAll(() => {
    const spec = AUTHORED_STYLES.find((s) => s.id === "bantu01");
    if (!spec) throw new Error("no bantu01");
    all = knots(spec.build({ head, body }));
  });

  it("parts the head into a dozen or more sections, one knot each", () => {
    expect(all.length).toBeGreaterThanOrEqual(12);
  });

  it("raises every knot as a bun: its apex stands at least 15 mm off the scalp, and at most 45 mm", () => {
    for (const [k, knot] of all.entries()) {
      const apex = Math.max(...knot.points.map((p) => body.probe(p).distance));
      expect(apex, `knot ${k}`).toBeGreaterThanOrEqual(0.015);
      expect(apex, `knot ${k}`).toBeLessThanOrEqual(0.045);
    }
  });

  it("sits every knot behind the hairline: no part of one near the skin lies on the forehead, temple or neck", () => {
    for (const [k, knot] of all.entries())
      for (const p of knot.points) {
        if (body.probe(p).distance > 0.01) continue;
        const d = new Vector3().subVectors(p, head.centre);
        const azimuth = (Math.atan2(d.x, d.z) * 180) / Math.PI;
        const elevation = (Math.asin(d.y / d.length()) * 180) / Math.PI;
        expect(elevation, `knot ${k} at azimuth ${azimuth.toFixed(0)}`).toBeGreaterThanOrEqual(
          hairlineElevation(azimuth),
        );
      }
  });

  it("coils round its own root's axis: the knot rises as it winds, not outward across the scalp", () => {
    for (const [k, { root, points }] of all.entries()) {
      const normal = body.probe(root).normal;
      // How far out across the scalp the knot reaches, against how high it stands.
      let across = 0;
      let up = 0;
      for (const p of points) {
        const d = new Vector3().subVectors(p, root);
        const h = d.dot(normal);
        up = Math.max(up, h);
        across = Math.max(across, d.addScaledVector(normal, -h).length());
      }
      expect(up, `knot ${k}: ${up.toFixed(3)} up, ${across.toFixed(3)} across`).toBeGreaterThan(
        0.9 * across,
      );
    }
  });
});

describe.each(AUTHORED_STYLES.map((s) => [s.id, s] as const))(
  "the authored style %s",
  (_id, spec) => {
    let cards: ReturnType<typeof spec.build>;
    beforeAll(() => {
      cards = spec.build({ head, body });
    });

    it("is a whole mesh: finite positions, every face's corners and UVs in range", () => {
      const vertices = cards.positions.length / 3;
      const uvs = cards.uvs.length / 2;
      expect(vertices).toBeGreaterThan(500);
      expect(cards.positions.every(Number.isFinite)).toBe(true);
      expect(cards.faceVerts.length).toBe(cards.faceUvs.length);
      expect(cards.faceVerts.every((v) => v >= 0 && v < vertices)).toBe(true);
      expect(cards.faceUvs.every((v) => v >= 0 && v < uvs)).toBe(true);
      // The atlas is one image: a rope reads only inside it.
      for (let i = 0; i < uvs; i++) {
        expect(cards.uvs[i * 2] as number).toBeGreaterThanOrEqual(0);
        expect(cards.uvs[i * 2] as number).toBeLessThanOrEqual(1);
        expect(cards.uvs[i * 2 + 1] as number).toBeGreaterThanOrEqual(0);
        expect(cards.uvs[i * 2 + 1] as number).toBeLessThanOrEqual(1);
      }
    });

    it("lies over the body and not through it: all but the sunk roots are outside it", () => {
      let inside = 0;
      const p = new Vector3();
      const vertices = cards.positions.length / 3;
      for (let v = 0; v < vertices; v++) {
        p.set(
          cards.positions[v * 3] as number,
          cards.positions[v * 3 + 1] as number,
          cards.positions[v * 3 + 2] as number,
        );
        if (body.probe(p).distance < -0.0015) inside++;
      }
      // The first ring of every rope is sunk 2 mm under the scalp so it grows from it.
      expect(inside / vertices).toBeLessThan(0.08);
    });

    it("is made the same every time", () => {
      const again = spec.build({ head, body });
      expect(again.positions).toEqual(cards.positions);
      expect(again.uvs).toEqual(cards.uvs);
    });

    it("binds to the base mesh and comes back where it was, at rest", () => {
      const asset = compileAuthored(
        spec.id,
        spec.label,
        cards,
        rest,
        `${spec.id}.webp`,
        spec.provenance,
      );
      expect(asset.vertexCount).toBe(cards.positions.length / 3);
      expect(asset.faceCount).toBe(cards.faceVerts.length / 4);
      const out = evaluateBinding(
        { ...asset.arrays, entry: { scale: asset.scale, vertexCount: asset.vertexCount } },
        rest.positions,
        new Float32Array(asset.vertexCount * 3),
      );
      let worst = 0;
      out.forEach((value, i) => {
        worst = Math.max(worst, Math.abs(value - (cards.positions[i] as number)));
      });
      expect(worst).toBeLessThan(1e-5);
    });
  },
);
