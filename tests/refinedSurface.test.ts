import { describe, expect, it } from "vitest";
import {
  buildRefinedSurfaceMesh,
  buildSurfaceMesh,
  evaluateSurface,
  type QuadSource,
  type SurfaceMesh,
} from "../src/build/surfaceMesh.ts";
import { groupFaces } from "../src/format/assetFormat.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const source: QuadSource = { ...assets, vertexCount: assets.manifest.vertexCount };
const body = groupFaces(assets, "body");
const P = assets.positions;

/** The pelvic faces and a one-vertex ring of them, graded 2 / 1 as the adult pack's spec does. */
function region() {
  const centroid = (f: number) =>
    [0, 1, 2].map(
      (k) =>
        [0, 1, 2, 3].reduce(
          (s, i) => s + (P[(assets.faceVerts[f * 4 + i] as number) * 3 + k] as number),
          0,
        ) / 4,
    ) as [number, number, number];
  const core = Array.from(body).filter((f) => {
    const [x, y, z] = centroid(f);
    return Math.abs(x) < 0.05 && y > -0.11 && y < 0.05 && z > -0.03;
  });
  const coreSet = new Set(core);
  const verts = new Set(
    core.flatMap((f) => [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number)),
  );
  const ring = Array.from(body).filter(
    (f) =>
      !coreSet.has(f) && [0, 1, 2, 3].some((k) => verts.has(assets.faceVerts[f * 4 + k] as number)),
  );
  return {
    faces: [...core, ...ring],
    levels: [...core.map(() => 2), ...ring.map(() => 1)],
  };
}

const evaluate = (mesh: SurfaceMesh, control: Float32Array) => {
  const n = mesh.renderToSurface.length;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  evaluateSurface(mesh, control, positions, normals);
  return { positions, normals };
};

/** Sum of the UV area of a mesh's triangles. */
function uvArea(mesh: SurfaceMesh) {
  let total = 0;
  for (let i = 0; i < mesh.index.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => mesh.index[i + k] as number) as [number, number, number];
    const ux = (mesh.uvs[b * 2] as number) - (mesh.uvs[a * 2] as number);
    const uy = (mesh.uvs[b * 2 + 1] as number) - (mesh.uvs[a * 2 + 1] as number);
    const vx = (mesh.uvs[c * 2] as number) - (mesh.uvs[a * 2] as number);
    const vy = (mesh.uvs[c * 2 + 1] as number) - (mesh.uvs[a * 2 + 1] as number);
    total += Math.abs(ux * vy - uy * vx) / 2;
  }
  return total;
}

describe("a body surface with local refinement", () => {
  it("is the plain surface when nothing is refined", () => {
    const plain = buildSurfaceMesh(source, body, 1);
    const same = buildRefinedSurfaceMesh(source, body, { faces: [], levels: [] }, 1);
    expect(Array.from(same.topology.faces)).toEqual(Array.from(plain.topology.faces));
    expect(Array.from(same.index)).toEqual(Array.from(plain.index));
    expect(Array.from(same.renderToSurface)).toEqual(Array.from(plain.renderToSurface));
    expect(Array.from(same.uvs)).toEqual(Array.from(plain.uvs));
    expect(Array.from(same.skinWeight)).toEqual(Array.from(plain.skinWeight));
    const a = evaluate(plain, P);
    const b = evaluate(same, P);
    expect(Array.from(b.positions)).toEqual(Array.from(a.positions));
  });

  it("adds vertices only where refined, and keeps every unrefined face's vertices exactly", () => {
    const refinement = region();
    const plain = buildSurfaceMesh(source, body, 1);
    const fine = buildRefinedSurfaceMesh(source, body, refinement, 1);
    expect(fine.renderToSurface.length).toBeGreaterThan(plain.renderToSurface.length + 2000);
    expect(fine.renderToSurface.length).toBeLessThan(plain.renderToSurface.length + 20000);
    const a = evaluate(plain, P).positions;
    const b = evaluate(fine, P).positions;
    // Away from the region (more than 12 cm from it) the surface is the same vertices.
    const key = (p: Float32Array, i: number) =>
      [0, 1, 2].map((k) => (p[i * 3 + k] as number).toFixed(6)).join(",");
    const baseSet = new Set(Array.from({ length: a.length / 3 }, (_, i) => key(a, i)));
    let far = 0;
    for (let i = 0; i < b.length / 3; i++) {
      const [x, y, z] = [0, 1, 2].map((k) => b[i * 3 + k] as number) as [number, number, number];
      if (Math.hypot(x, y - -0.03, z - 0.05) > 0.2) {
        far++;
        expect(baseSet.has(key(b, i)), `vertex ${i}`).toBe(true);
      }
    }
    expect(far).toBeGreaterThan(30000);
  });

  it("is quads throughout after one level, and a level 0 surface still draws every face", () => {
    const fine = buildRefinedSurfaceMesh(source, body, region(), 1);
    expect(fine.topology.faces.length % 4).toBe(0);
    const flat = buildRefinedSurfaceMesh(source, body, region(), 0);
    // Level 0 keeps the control polygons: each is fanned into triangles.
    expect(flat.index.length / 3).toBeGreaterThan(body.length * 2);
    const positions = evaluate(flat, P).positions;
    expect(positions.every(Number.isFinite)).toBe(true);
  });

  it("keeps the UV layout: the surface's UV area is the plain surface's, seams included", () => {
    const plain = buildSurfaceMesh(source, body, 1);
    const fine = buildRefinedSurfaceMesh(source, body, region(), 1);
    const ratio = uvArea(fine) / uvArea(plain);
    expect(ratio).toBeGreaterThan(0.9999);
    expect(ratio).toBeLessThan(1.0001);
    expect(fine.uvs.every((u) => u >= -1e-6 && u <= 1 + 1e-6)).toBe(true);
  });

  it("follows the base's skin weights: normalised, bones in range, none lost", () => {
    const fine = buildRefinedSurfaceMesh(source, body, region(), 1);
    const n = fine.renderToSurface.length;
    expect(fine.skinIndex.length).toBe(n * 4);
    const bones = assets.manifest.skeleton.bones.length;
    for (let r = 0; r < n; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += fine.skinWeight[r * 4 + k] as number;
        expect(fine.skinIndex[r * 4 + k] as number).toBeLessThan(bones);
      }
      expect(sum).toBeCloseTo(1, 4);
    }
  });

  it("stays on the base surface: every refined vertex within 1.5 mm of it", () => {
    // A finer control polygon shrinks less under Catmull–Clark than the base's
    // coarse one, so the refined surface sits slightly off the base's: measured
    // 1.24 mm at worst around the pelvis, where the base's quads are 19 mm.
    const plain = buildSurfaceMesh(source, body, 1);
    const fine = buildRefinedSurfaceMesh(source, body, region(), 1);
    const a = evaluate(plain, P).positions;
    const b = evaluate(fine, P).positions;
    const near = (p: Float32Array, i: number) =>
      Math.abs(p[i * 3] as number) < 0.07 &&
      (p[i * 3 + 1] as number) > -0.14 &&
      (p[i * 3 + 1] as number) < 0.08 &&
      (p[i * 3 + 2] as number) > -0.05;
    const tris: number[][] = [];
    for (let i = 0; i < plain.index.length; i += 3) {
      const t = [0, 1, 2].map((k) => plain.index[i + k] as number);
      if (t.some((v) => near(a, v))) tris.push(t);
    }
    const dist = (px: number, py: number, pz: number, t: number[]) => {
      // Distance to a triangle (Ericson, Real-Time Collision Detection).
      const v = (i: number) =>
        [
          a[(t[i] as number) * 3],
          a[(t[i] as number) * 3 + 1],
          a[(t[i] as number) * 3 + 2],
        ] as number[];
      const [A, B, C] = [v(0), v(1), v(2)] as [number[], number[], number[]];
      const sub = (u: number[], w: number[]) =>
        [
          (u[0] as number) - (w[0] as number),
          (u[1] as number) - (w[1] as number),
          (u[2] as number) - (w[2] as number),
        ] as number[];
      const dot = (u: number[], w: number[]) =>
        (u[0] as number) * (w[0] as number) +
        (u[1] as number) * (w[1] as number) +
        (u[2] as number) * (w[2] as number);
      const p = [px, py, pz];
      const ab = sub(B, A);
      const ac = sub(C, A);
      const ap = sub(p, A);
      const d1 = dot(ab, ap);
      const d2 = dot(ac, ap);
      let q: number[];
      const bp = sub(p, B);
      const d3 = dot(ab, bp);
      const d4 = dot(ac, bp);
      const cp = sub(p, C);
      const d5 = dot(ab, cp);
      const d6 = dot(ac, cp);
      const vc = d1 * d4 - d3 * d2;
      const vb = d5 * d2 - d1 * d6;
      const va = d3 * d6 - d5 * d4;
      if (d1 <= 0 && d2 <= 0) q = A;
      else if (d3 >= 0 && d4 <= d3) q = B;
      else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const w = d1 / (d1 - d3);
        q = A.map((x, k) => x + w * (ab[k] as number));
      } else if (d6 >= 0 && d5 <= d6) q = C;
      else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        q = A.map((x, k) => x + w * (ac[k] as number));
      } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
        q = B.map((x, k) => x + w * ((C[k] as number) - (B[k] as number)));
      } else {
        const denom = 1 / (va + vb + vc);
        const vv = vb * denom;
        const ww = vc * denom;
        q = A.map((x, k) => x + (ab[k] as number) * vv + (ac[k] as number) * ww);
      }
      return Math.hypot(px - (q[0] as number), py - (q[1] as number), pz - (q[2] as number));
    };
    let worst = 0;
    for (let i = 0; i < b.length / 3; i++) {
      if (!near(b, i)) continue;
      let best = Number.POSITIVE_INFINITY;
      for (const t of tris)
        best = Math.min(
          best,
          dist(b[i * 3] as number, b[i * 3 + 1] as number, b[i * 3 + 2] as number, t),
        );
      worst = Math.max(worst, best);
    }
    expect(worst).toBeLessThan(0.0015);
    expect(worst).toBeGreaterThan(0); // it is a different, finer surface, not the same one
  });
});
