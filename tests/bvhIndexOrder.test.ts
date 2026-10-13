/**
 * A MeshBVH built in place reorders the index it is given. The packer shares the model's body
 * triangles between its head frame, its body surface, every style's binding and every style's
 * measured fields, so each of them must leave that array as it was, and every query must name a
 * triangle by its place in the caller's own index (`src/surface/meshBvh.ts`).
 */
import { DoubleSide, Ray, Triangle, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { bindToBody } from "../scripts/lib/hairCards/bind.ts";
import { BodySurface, HeadFrame } from "../scripts/lib/hairCards/head.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { hairFields, scalpShade } from "../src/surface/hairFields.ts";
import { meshBvh } from "../src/surface/meshBvh.ts";
import { loadHairFixtureAssets } from "./hairFixtures.ts";

let rest: ReturnType<HumanoidModel["restHead"]>;
/** The model's triangles as it made them, before any BVH was built over them. */
let pristine: Uint32Array;

beforeAll(() => {
  rest = new HumanoidModel(loadHairFixtureAssets(), { subdivision: 0 }).restHead();
  pristine = rest.triangles.slice();
});

/** Points round the head and down the body, some outside and some just under the skin. */
function probes(head: HeadFrame): Vector3[] {
  const out: Vector3[] = [];
  for (let a = 0; a < 24; a++)
    for (const e of [-0.6, -0.2, 0.2, 0.6, 1.2])
      for (const r of [0.06, 0.1, 0.14]) {
        const azimuth = (a / 24) * Math.PI * 2;
        out.push(
          new Vector3(Math.sin(azimuth) * Math.cos(e), Math.sin(e), Math.cos(azimuth) * Math.cos(e))
            .multiplyScalar(r)
            .add(head.centre),
        );
      }
  return out;
}

describe("BVHs over the shared body triangles", () => {
  it("leave the model's triangles as they were", () => {
    const before = rest.triangles.slice();
    const head = new HeadFrame(rest);
    new BodySurface(rest, head);
    bindToBody(Float32Array.of(0, 1.6, 0.1, 0.05, 1.7, 0), rest);
    scalpShade(Float32Array.of(0, 1.7, 0), rest);
    hairFields({
      positions: Float32Array.of(-0.01, 1.75, 0, 0.01, 1.75, 0, 0.01, 1.77, 0, -0.01, 1.77, 0),
      faceVerts: Uint32Array.of(0, 1, 2, 3),
      body: rest,
      scalpEligible: rest.head,
    });
    // Compared as bytes: a failing deep-equal of 75,000 indices takes minutes to print.
    expect(Buffer.from(rest.triangles.buffer).equals(Buffer.from(before.buffer))).toBe(true);
  });

  it("resolve every query to the triangle's place in the caller's index", () => {
    const triangles = pristine.slice();
    const bvh = meshBvh(rest.positions, triangles);
    expect(Buffer.from(triangles.buffer).equals(Buffer.from(pristine.buffer))).toBe(true);
    const face = (index: number) =>
      new Triangle(
        ...([0, 1, 2].map((k) =>
          new Vector3().fromArray(rest.positions, (triangles[index * 3 + k] as number) * 3),
        ) as [Vector3, Vector3, Vector3]),
      );
    // A hit's point is on the triangle its face index names in the caller's own order.
    const onFace = (index: number, p: Vector3) =>
      face(index).closestPointToPoint(p, new Vector3()).distanceTo(p);
    const head = new HeadFrame(rest);
    const target = { point: new Vector3(), distance: 0, faceIndex: 0 };
    const points = probes(head);
    for (const p of points) {
      const hit = bvh.closestPointToPoint(p, target);
      if (!hit) throw new Error("no closest point");
      expect(onFace(hit.faceIndex, hit.point)).toBeLessThan(1e-6);
    }
    let raycasts = 0;
    for (const p of points)
      for (const hit of bvh.raycast(
        new Ray(head.centre.clone(), p.clone().sub(head.centre).normalize()),
        DoubleSide,
      ))
        if (typeof hit.faceIndex === "number") {
          expect(onFace(hit.faceIndex, hit.point)).toBeLessThan(1e-6);
          raycasts++;
        }
    expect(raycasts).toBeGreaterThan(points.length / 2);
    let shapecasts = 0;
    bvh.shapecast({
      intersectsBounds: () => true,
      intersectsTriangle: (tri, index) => {
        const named = face(index);
        expect([tri.a, tri.b, tri.c].map((v) => v.toArray())).toEqual(
          [named.a, named.b, named.c].map((v) => v.toArray()),
        );
        shapecasts++;
        return false;
      },
    });
    expect(shapecasts).toBe(triangles.length / 3);
  });
});
