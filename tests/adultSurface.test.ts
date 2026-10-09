import { describe, expect, it } from "vitest";
import { adultAnatomySpec } from "../scripts/lib/adultAnatomySpec.ts";
import { PELVIS_CORE, pelvicRefinement } from "../scripts/lib/pelvicRegion.ts";
import { groupFaces } from "../src/format/assetFormat.ts";
import { refineGraded } from "../src/subdiv/gradedRefine.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const P = assets.positions;
const centroid = (f: number) =>
  [0, 1, 2].map(
    (k) =>
      [0, 1, 2, 3].reduce(
        (s, i) => s + (P[(assets.faceVerts[f * 4 + i] as number) * 3 + k] as number),
        0,
      ) / 4,
  ) as [number, number, number];

describe("the pelvic refinement the adult pack asks for", () => {
  const r = pelvicRefinement(assets);
  const body = new Set(Array.from(groupFaces(assets, "body")));
  const core = r.faces.filter((_, i) => r.levels[i] === 2);
  const ring = r.faces.filter((_, i) => r.levels[i] === 1);

  it("is body faces only, each once, at levels 2 (core) and 1 (the ring round it)", () => {
    expect(new Set(r.faces).size).toBe(r.faces.length);
    for (const f of r.faces) expect(body.has(f), `face ${f}`).toBe(true);
    expect(r.levels.every((l) => l === 1 || l === 2)).toBe(true);
    expect(core.length).toBeGreaterThan(60);
    expect(core.length).toBeLessThan(160);
    expect(ring.length).toBeGreaterThan(30);
  });

  it("puts the core inside the pelvic box, on both sides of the midline alike", () => {
    for (const f of core) {
      const [x, y, z] = centroid(f);
      expect(Math.abs(x)).toBeLessThan(PELVIS_CORE.halfWidth);
      expect(y).toBeGreaterThan(PELVIS_CORE.yMin);
      expect(y).toBeLessThan(PELVIS_CORE.yMax);
      expect(z).toBeGreaterThan(PELVIS_CORE.zMin);
    }
    const left = core.filter((f) => centroid(f)[0] > 0).length;
    const right = core.filter((f) => centroid(f)[0] < 0).length;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(4);
  });

  it("is graded: every neighbour of the core is in the ring, so levels never jump by two", () => {
    expect(() =>
      refineGraded(
        { ...assets, vertexCount: assets.manifest.vertexCount },
        groupFaces(assets, "body"),
        r,
      ),
    ).not.toThrow();
    const coreVerts = new Set(
      core.flatMap((f) => [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number)),
    );
    const inSpec = new Set(r.faces);
    for (const f of body)
      if ([0, 1, 2, 3].some((k) => coreVerts.has(assets.faceVerts[f * 4 + k] as number)))
        expect(inSpec.has(f), `face ${f} touches the core`).toBe(true);
  });

  it("is the pack's own spec, the one in the shipped manifest", () => {
    const spec = adultAnatomySpec(assets);
    expect(spec.surface).toEqual({ faces: r.faces, levels: r.levels });
    // Its detail (the generated targets' pin) is held to the generator in moundPack.test.ts.
    const { detail: _detail, ...rest } = adultManifest.anatomy ?? {};
    expect(rest).toEqual(spec);
  });
});
