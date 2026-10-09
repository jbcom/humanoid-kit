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

// Each surface is built once for the file: they take seconds apiece.
const built = new Map<string, SurfaceMesh>();
const memo = (id: string, make: () => SurfaceMesh) => {
  let m = built.get(id);
  if (!m) {
    m = make();
    built.set(id, m);
  }
  return m;
};
const plainSurface = (level: number) =>
  memo(`plain${level}`, () => buildSurfaceMesh(source, body, level));
const fineSurface = (level: number) =>
  memo(`fine${level}`, () => buildRefinedSurfaceMesh(source, body, region(), level));

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

/** How many triangles each undirected edge of the surface (UV seams joined) belongs to. */
function edgeUse(mesh: SurfaceMesh) {
  const use = new Map<string, number>();
  const s = (r: number) => mesh.renderToSurface[r] as number;
  for (let i = 0; i < mesh.index.length; i += 3) {
    const t = [0, 1, 2].map((k) => s(mesh.index[i + k] as number));
    // A triangle drawn as a quad has a repeated corner: its second half is degenerate.
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue;
    for (let k = 0; k < 3; k++) {
      const a = t[k] as number;
      const b = t[(k + 1) % 3] as number;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      use.set(key, (use.get(key) ?? 0) + 1);
    }
  }
  return use;
}

const key = (p: Float32Array, i: number) =>
  [0, 1, 2].map((k) => (p[i * 3 + k] as number).toFixed(6)).join(",");

// Building a surface takes seconds, several times over on a busy machine.
describe("a body surface with local refinement", { timeout: 600_000 }, () => {
  it("is the plain surface when nothing is refined, at every level it can be built", () => {
    for (const level of [1, 2]) {
      const plain = plainSurface(level);
      const same = buildRefinedSurfaceMesh(source, body, { faces: [], levels: [] }, level);
      expect(Array.from(same.topology.faces)).toEqual(Array.from(plain.topology.faces));
      expect(Array.from(same.index)).toEqual(Array.from(plain.index));
      expect(Array.from(same.renderToSurface)).toEqual(Array.from(plain.renderToSurface));
      expect(Array.from(same.uvs)).toEqual(Array.from(plain.uvs));
      expect(Array.from(same.skinWeight)).toEqual(Array.from(plain.skinWeight));
      expect(Array.from(evaluate(same, P).positions)).toEqual(
        Array.from(evaluate(plain, P).positions),
      );
    }
  });

  it("refines the base's own level-1 surface: no base vertex moves, new ones are added in the region", () => {
    const plain = plainSurface(1);
    const fine = fineSurface(1);
    expect(fine.renderToSurface.length).toBeGreaterThan(plain.renderToSurface.length + 2000);
    expect(fine.renderToSurface.length).toBeLessThan(plain.renderToSurface.length + 20000);
    const a = evaluate(plain, P).positions;
    const b = evaluate(fine, P).positions;
    // Every vertex of the plain surface is a vertex of the refined one, exactly.
    const fineSet = new Set(Array.from({ length: b.length / 3 }, (_, i) => key(b, i)));
    for (let i = 0; i < a.length / 3; i++) expect(fineSet.has(key(a, i)), `vertex ${i}`).toBe(true);
    // And away from the region there is nothing else.
    const baseSet = new Set(Array.from({ length: a.length / 3 }, (_, i) => key(a, i)));
    for (let i = 0; i < b.length / 3; i++) {
      const [x, y, z] = [0, 1, 2].map((k) => b[i * 3 + k] as number) as [number, number, number];
      if (Math.hypot(x, y - -0.03, z - 0.05) > 0.2) expect(baseSet.has(key(b, i))).toBe(true);
    }
  });

  it("is conforming: no cracks, and the same border as the plain surface", () => {
    const plain = plainSurface(1);
    const fine = fineSurface(1);
    const border = (m: SurfaceMesh) => [...edgeUse(m).values()].filter((n) => n === 1).length;
    for (const n of edgeUse(fine).values()) expect([1, 2]).toContain(n);
    // The refinement is interior: the body's open borders (eyes, mouth, neck…) are the same.
    expect(border(fine)).toBe(border(plain));
  });

  it("keeps the surface the base draws: refined vertices lie on it, within 0.6 mm", () => {
    // They are bilinear on the level-1 surface's own quads, not a new smoothing of
    // the coarse mesh, so refining adds detail without changing the shape.
    const plain = plainSurface(1);
    const fine = fineSurface(1);
    const a = evaluate(plain, P).positions;
    const b = evaluate(fine, P).positions;
    const baseSet = new Set(Array.from({ length: a.length / 3 }, (_, i) => key(a, i)));
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
    let added = 0;
    for (let i = 0; i < b.length / 3; i++) {
      if (!near(b, i) || baseSet.has(key(b, i))) continue;
      added++;
      let best = Number.POSITIVE_INFINITY;
      for (const t of tris)
        best = Math.min(
          best,
          dist(b[i * 3] as number, b[i * 3 + 1] as number, b[i * 3 + 2] as number, t),
        );
      worst = Math.max(worst, best);
    }
    expect(added).toBeGreaterThan(2000);
    // Within half the warp of the base's own quads (0.44 mm measured): the base draws
    // each quad as two triangles, the refinement is bilinear on the quad.
    expect(worst).toBeLessThan(0.0006);
  });

  it("shades smoothly: normals interpolate the base's, so no edge turns sharper than the base's own", () => {
    // Flat-face normals on the new vertices against the smoothed ones at the base's
    // would band the shading at the base's quad size (seen in the contact sheet).
    const maxTurn = (mesh: SurfaceMesh) => {
      const n = evaluate(mesh, P).normals;
      let worst = 0;
      for (let i = 0; i < mesh.index.length; i += 3)
        for (let k = 0; k < 3; k++) {
          const a = mesh.index[i + k] as number;
          const b = mesh.index[i + ((k + 1) % 3)] as number;
          if (a === b) continue;
          const dot =
            (n[a * 3] as number) * (n[b * 3] as number) +
            (n[a * 3 + 1] as number) * (n[b * 3 + 1] as number) +
            (n[a * 3 + 2] as number) * (n[b * 3 + 2] as number);
          worst = Math.max(worst, Math.acos(Math.min(1, Math.max(-1, dot))));
        }
      return worst;
    };
    const plain = plainSurface(1);
    const fine = fineSurface(1);
    const out = evaluate(fine, P).normals;
    for (let r = 0; r < out.length / 3; r++)
      expect(
        Math.hypot(out[r * 3] as number, out[r * 3 + 1] as number, out[r * 3 + 2] as number),
      ).toBeCloseTo(1, 4);
    expect(maxTurn(fine)).toBeLessThanOrEqual(maxTurn(plain) * 1.02);
    // And away from the new vertices the normals are the base's, exactly.
    const a = evaluate(plain, P);
    const b = evaluate(fine, P);
    const at = (p: Float32Array, i: number) =>
      [0, 1, 2].map((k) => (p[i * 3 + k] as number).toFixed(6)).join(",");
    const normalAt = new Map<string, string>();
    for (let i = 0; i < a.positions.length / 3; i++)
      normalAt.set(at(a.positions, i), at(a.normals, i));
    let same = 0;
    for (let i = 0; i < b.positions.length / 3; i++) {
      const want = normalAt.get(at(b.positions, i));
      if (want !== undefined && want === at(b.normals, i)) same++;
    }
    expect(same).toBeGreaterThan(a.positions.length / 3 - 400);
  });

  it("keeps the UV layout: the surface's UV area is the plain surface's, seams included", () => {
    const plain = plainSurface(1);
    const fine = fineSurface(1);
    const ratio = uvArea(fine) / uvArea(plain);
    expect(ratio).toBeGreaterThan(0.9999);
    expect(ratio).toBeLessThan(1.0001);
    expect(fine.uvs.every((u) => u >= -1e-6 && u <= 1 + 1e-6)).toBe(true);
  });

  it("follows the base's skin weights: normalised, bones in range, none lost", () => {
    const fine = fineSurface(1);
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

  it("at level 2 the transition polygons are smoothed into quads, finite and conforming", () => {
    const plain = plainSurface(2);
    const fine = fineSurface(2);
    expect(fine.topology.faces.length % 4).toBe(0);
    expect(fine.renderToSurface.length).toBeGreaterThan(plain.renderToSurface.length);
    const out = evaluate(fine, P);
    expect(out.positions.every(Number.isFinite)).toBe(true);
    expect(out.normals.every(Number.isFinite)).toBe(true);
    for (const n of edgeUse(fine).values()) expect([1, 2]).toContain(n);
    const border = (m: SurfaceMesh) => [...edgeUse(m).values()].filter((n) => n === 1).length;
    expect(border(fine)).toBe(border(plain));
  });

  it.each([1, 2])("at level %i says which triangles each control face owns", (level) => {
    const fine = fineSurface(level);
    const starts = fine.faceTriangles as Uint32Array;
    expect(starts.length).toBe(body.length + 1);
    expect(starts[0]).toBe(0);
    expect(starts[body.length]).toBe(fine.index.length / 3);
    // A face the refinement leaves alone is drawn as the plain surface draws it
    // (two triangles per cell, 4^level cells), unless a refined neighbour's
    // hanging points make it a transition polygon; a refined face has more.
    const plainOwns = 2 * 4 ** level;
    let same = 0;
    let finer = 0;
    for (let i = 0; i < body.length; i++) {
      const owns = (starts[i + 1] as number) - (starts[i] as number);
      expect(owns).toBeGreaterThanOrEqual(plainOwns);
      if (owns === plainOwns) same++;
      else finer++;
    }
    expect(finer).toBeGreaterThan(0);
    expect(same).toBeGreaterThan(body.length * 0.9);
  });

  it("needs a subdivision level: the refinement is defined on the level-1 surface", () => {
    expect(() => buildRefinedSurfaceMesh(source, body, region(), 0)).toThrow(RangeError);
  });
});
