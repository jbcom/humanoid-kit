/**
 * Patches of the refined adult surface (src/build/patches.ts): a patch's vertices
 * are the affine combinations it declares, through every shape; a pack without
 * patches is refined exactly as before; and a patch must fill the region it removes.
 */
import { describe, expect, it } from "vitest";
import type { SurfacePatch } from "../src/build/patches.ts";
import { buildRefinedSurfaceMesh, type SurfaceMesh } from "../src/build/surfaceMesh.ts";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { applyStencil } from "../src/subdiv/catmullClark.ts";
import { adultManifest, adultPackData, bodyPackData, loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets(true);
const source = { ...assets, vertexCount: assets.manifest.vertexCount };
const shipped = adultManifest.anatomy?.surface;
if (!shipped) throw new Error("the adult pack has no surface");
/** The pack's refinement without its own patches. */
const spec = { faces: shipped.faces, levels: shipped.levels };
const plain = buildRefinedSurfaceMesh(source, null, spec, 1);
const lattice = plain.lattice;
if (!lattice) throw new Error("no lattice");

/** A refined quad remeshed as a fan round two new points, its edges kept. */
function splitQuad(): { patch: SurfacePatch; corners: number[]; polygon: number } {
  const L = lattice as NonNullable<SurfaceMesh["lattice"]>;
  const p = Array.from({ length: L.polygons.id.length }, (_, i) => i).find(
    (i) => (L.polygons.start[i + 1] as number) - (L.polygons.start[i] as number) === 4,
  ) as number;
  const s = L.polygons.start[p] as number;
  const corners = Array.from(L.polygons.vertices.subarray(s, s + 4));
  const uvs = Array.from(L.polygons.uvs.subarray(s, s + 4));
  const n = L.vertexCount;
  const u = L.uvCount;
  // New vertices: an off-centre point m, and a point q between m and corner a (combining
  // a new vertex), so the quad is a fan of five round them; its edges are kept.
  const [a, b, c, d] = corners as [number, number, number, number];
  const [ua, ub, uc, ud] = uvs as [number, number, number, number];
  const [m, q] = [n, n + 1];
  const [um, uq] = [u, u + 1];
  const off = { from: [a, b, c, d], weights: [0.4, 0.3, 0.2, 0.1] };
  const between = { from: [a, m], weights: [0.25, 0.75] };
  const offUv = { from: [ua, ub, uc, ud], weights: off.weights };
  const betweenUv = { from: [ua, um], weights: between.weights };
  return {
    corners,
    polygon: L.polygons.id[p] as number,
    patch: {
      remove: [L.polygons.id[p] as number],
      vertices: [off, between],
      uvs: [offUv, betweenUv],
      polygons: [
        { vertices: [a, b, m, q], uvs: [ua, ub, um, uq] },
        { vertices: [b, c, m], uvs: [ub, uc, um] },
        { vertices: [c, d, m], uvs: [uc, ud, um] },
        { vertices: [d, a, q, m], uvs: [ud, ua, uq, um] },
      ].map((poly) => ({ ...poly, of: L.polygons.id[p] as number })),
    },
  };
}

describe("patches of the refined surface", { timeout: 300_000 }, () => {
  it("is the same surface, array for array, with no patches", () => {
    const none = buildRefinedSurfaceMesh(source, null, { ...spec, patches: [] }, 1);
    for (const key of [
      "renderToSurface",
      "renderUv",
      "uvs",
      "index",
      "skinIndex",
      "skinWeight",
    ] as const)
      expect(Array.from(none[key]), key).toEqual(Array.from(plain[key]));
    expect(Array.from(none.topology.faces)).toEqual(Array.from(plain.topology.faces));
    expect(Array.from(none.stencil.weights)).toEqual(Array.from(plain.stencil.weights));
    expect(none.lattice?.key).toBe(plain.lattice?.key);
  });

  it("puts a patch's vertices at the affine combinations they are declared to be, on any shape", () => {
    const { patch, corners } = splitQuad();
    const mesh = buildRefinedSurfaceMesh(source, null, { ...spec, patches: [patch] }, 1);
    expect(mesh.lattice?.key, "a patch names another lattice").not.toBe(plain.lattice?.key);
    const control = Float32Array.from(assets.positions);
    // A shape the base does not have at rest: every control vertex moved its own way.
    for (let i = 0; i < control.length; i++)
      control[i] = (control[i] as number) + 0.01 * Math.sin(i);
    const at = applyStencil(mesh.stencil, control, new Float32Array(mesh.topology.vertexCount * 3));
    const n = (lattice as NonNullable<SurfaceMesh["lattice"]>).vertexCount;
    let worst = 0;
    patch.vertices.forEach((c, i) => {
      for (let k = 0; k < 3; k++) {
        const want = c.from.reduce(
          (s, v, j) => s + (c.weights[j] as number) * (at[v * 3 + k] as number),
          0,
        );
        worst = Math.max(worst, Math.abs((at[(n + i) * 3 + k] as number) - want));
      }
    });
    expect(worst).toBeLessThan(1e-6);
    // The quad it replaced is four quads now, drawn about its centre.
    const drawn = new Set(Array.from(mesh.renderToSurface));
    expect(drawn.has(n)).toBe(true);
    expect(corners.every((v) => drawn.has(v))).toBe(true);
  });

  it("refuses a patch that does not fill the region it removes", () => {
    const { patch } = splitQuad();
    const short = { ...patch, polygons: patch.polygons.slice(1) };
    expect(() => buildRefinedSurfaceMesh(source, null, { ...spec, patches: [short] }, 1)).toThrow(
      /fill the region/,
    );
  });

  it("loads a pack written before patches, and draws its adult surface", () => {
    // A manifest as one was written before patches: the refinement alone, with nothing
    // (reservoirs, detail) named on a patched lattice.
    const manifest = structuredClone(adultManifest);
    const anatomy = manifest.anatomy as NonNullable<typeof manifest.anatomy>;
    anatomy.surface = { faces: shipped.faces, levels: shipped.levels };
    delete anatomy.reservoirs;
    delete anatomy.detail;
    const model = new HumanoidModel(
      parseHumanoidAssets(bodyPackData(), { ...adultPackData(), manifest }),
      { subdivision: 1 },
    );
    expect(model.evaluate(createRecipe({ macros: { age: 30 } })).surface).toBe("adult");
  });
});
