import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { groupFaces } from "../src/format/assetFormat.ts";
import {
  applyStencil,
  catmullClarkLevel,
  catmullClarkPolygons,
  subdivideUvLinear,
  subdivideUvLinearPolygons,
} from "../src/subdiv/catmullClark.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const starts = (n: number, size = 4) => Uint32Array.from({ length: n + 1 }, (_, i) => i * size);

describe("Catmull–Clark on polygons", () => {
  it("gives the body the same subdivision as the quad-only code that preceded it, bit for bit", () => {
    // The hash of the body's level-1 stencil and faces as the original quad-only
    // implementation produced them, recorded before `catmullClarkLevel` became
    // this function on quads: any change to the rules or the order shows here.
    const assets = loadFixtureAssets();
    const body = Array.from(groupFaces(assets, "body"));
    const faces = Uint32Array.from(
      body.flatMap((f) => [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number)),
    );
    const topo = { vertexCount: assets.manifest.vertexCount, faces };
    const level = catmullClarkLevel(topo);
    const hash = createHash("sha256");
    for (const a of [
      level.stencil.offsets,
      level.stencil.src,
      level.stencil.weights,
      level.topology.faces,
    ])
      hash.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
    expect(level.topology.vertexCount).toBe(59292);
    expect(hash.digest("hex")).toBe(
      "f8cfccf7b13dbe6d4acc0d5ed30f580901fb261761896e50dd25f7203b6684e5",
    );
    // And the polygon entry point is the same function.
    const poly = catmullClarkPolygons({ ...topo, faceStart: starts(body.length) });
    expect(Array.from(poly.topology.faces)).toEqual(Array.from(level.topology.faces));
  });

  it("turns each n-gon into n quads, with an edge point per edge and a face point", () => {
    // A single regular pentagon in the plane, an open polygon: all its edges are borders.
    const pentagon = Float32Array.from(
      Array.from({ length: 5 }, (_, i) => [
        Math.cos((2 * Math.PI * i) / 5),
        Math.sin((2 * Math.PI * i) / 5),
        0,
      ]).flat(),
    );
    const level = catmullClarkPolygons({
      vertexCount: 5,
      faceStart: Uint32Array.of(0, 5),
      faces: Uint32Array.of(0, 1, 2, 3, 4),
    });
    expect(level.topology.vertexCount).toBe(5 + 5 + 1);
    expect(level.topology.faces.length / 4).toBe(5);
    const out = applyStencil(level.stencil, pentagon, new Float32Array(11 * 3));
    // The face point is the centroid, an edge point the midpoint of its border edge.
    expect(out[10 * 3]).toBeCloseTo(0, 6);
    expect(out[10 * 3 + 1]).toBeCloseTo(0, 6);
    const mid = (a: number, b: number, k: number) =>
      ((pentagon[a * 3 + k] as number) + (pentagon[b * 3 + k] as number)) / 2;
    expect(out[5 * 3]).toBeCloseTo(mid(0, 1, 0), 6);
    expect(out[5 * 3 + 1]).toBeCloseTo(mid(0, 1, 1), 6);
  });

  it("makes a closed mesh with n-gons a closed quad mesh, a partition of unity throughout", () => {
    // A pentagonal prism: two pentagons and five quads.
    const top = [0, 1, 2, 3, 4];
    const bottom = [5, 6, 7, 8, 9];
    const faces: number[] = [...top, ...[...bottom].reverse()];
    const start = [0, 5, 10];
    for (let i = 0; i < 5; i++) {
      faces.push(i, (i + 1) % 5, 5 + ((i + 1) % 5), 5 + i);
      start.push(faces.length);
    }
    const level = catmullClarkPolygons({
      vertexCount: 10,
      faceStart: Uint32Array.from(start),
      faces: Uint32Array.from(faces),
    });
    // V' − E' + F' = 2 for a closed surface; every output face is a quad.
    const V = level.topology.vertexCount;
    const F = level.topology.faces.length / 4;
    expect(F).toBe(5 + 5 + 4 * 5); // an n-gon makes n quads
    const edges = new Set<string>();
    for (let f = 0; f < F; f++)
      for (let k = 0; k < 4; k++) {
        const a = level.topology.faces[f * 4 + k] as number;
        const b = level.topology.faces[f * 4 + ((k + 1) % 4)] as number;
        edges.add(a < b ? `${a}-${b}` : `${b}-${a}`);
      }
    expect(V - edges.size + F).toBe(2);
    const s = level.stencil;
    for (let i = 0; i + 1 < s.offsets.length; i++) {
      let sum = 0;
      for (let k = s.offsets[i] as number; k < (s.offsets[i + 1] as number); k++)
        sum += s.weights[k] as number;
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it("subdivides the UVs of polygons linearly, matching the quad version on quads", () => {
    const assets = loadFixtureAssets();
    const body = Array.from(groupFaces(assets, "body")).slice(0, 400);
    const faceUvs = Uint32Array.from(
      body.flatMap((f) => [0, 1, 2, 3].map((k) => assets.faceUvs[f * 4 + k] as number)),
    );
    const quad = subdivideUvLinear(assets.uvs, faceUvs);
    const poly = subdivideUvLinearPolygons(assets.uvs, starts(body.length), faceUvs);
    expect(Array.from(poly.faceUvs)).toEqual(Array.from(quad.faceUvs));
    expect(Array.from(poly.uvs)).toEqual(Array.from(quad.uvs));
    // A pentagon's face point is the mean of its UVs, an edge point the midpoint.
    const uvs = Float32Array.from([0, 0, 1, 0, 1.5, 1, 0.5, 2, -0.5, 1]);
    const p = subdivideUvLinearPolygons(uvs, Uint32Array.of(0, 5), Uint32Array.of(0, 1, 2, 3, 4));
    expect(p.faceUvs.length).toBe(20);
    const facePoint = p.faceUvs[2] as number; // the face point of the first output quad
    expect(p.uvs[facePoint * 2]).toBeCloseTo((0 + 1 + 1.5 + 0.5 - 0.5) / 5, 6);
    expect(p.uvs[facePoint * 2 + 1]).toBeCloseTo((0 + 0 + 1 + 2 + 1) / 5, 6);
  });
});
