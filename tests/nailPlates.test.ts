import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileAsset } from "../scripts/lib/compileAsset.ts";
import { NAIL_PLATES, VENDOR_BODYPARTS04 } from "../scripts/lib/nailPlates.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createAttachmentMaterial, NailPlateMaterial } from "../src/render/attachmentLook.ts";
import {
  NAIL_FREE_EDGE_OPACITY,
  NAIL_PLATE_KINDS,
  NAIL_PLATE_OPACITY,
} from "../src/surface/regions/hands/index.ts";
import { loadFixtureAssets } from "./fixtures.ts";

describe("the nail plates' source", () => {
  it("proves CC0 by their captured asset pages", () => {
    for (const [id, kind, file, page] of NAIL_PLATES) {
      const c = compileAsset(path.join(VENDOR_BODYPARTS04, file), id, kind, {
        page,
        geometryOnly: true,
      });
      expect(Object.keys(c.evidence)).toHaveLength(2);
      for (const ev of Object.values(c.evidence))
        expect(ev).toMatch(
          /^B: page licence "CC0.*\(<http:\/\/www\.makehumancommunity\.org\/node\/\d+>/,
        );
      // Geometry only: the asset's painted texture is neither read nor packed.
      expect(c.textures.size).toBe(0);
      expect(c.material.texture).toBeNull();
      expect(c.arrays.deleteVerts).toHaveLength(0);
    }
  });

  it("refuses a plate whose captured page does not say CC0", () => {
    const [id, kind, file, page] = NAIL_PLATES[0] as (typeof NAIL_PLATES)[number];
    expect(() =>
      compileAsset(path.join(VENDOR_BODYPARTS04, file), id, kind, {
        page: { ...page, licence: "CC-BY 4.0" },
        geometryOnly: true,
      }),
    ).toThrow(/licence gate/);
  });
});

describe("the nail plates on a figure", () => {
  const topology = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 }).topology();
  const plates = topology.attachments.filter((a) => NAIL_PLATE_KINDS.includes(a.kind));

  it("come with the body: fingernails and toenails", () => {
    expect(plates.map((p) => p.kind).sort()).toEqual(["fingernails", "toenails"]);
  });

  it("know their free edge: clear over the bed, a narrow edge at each tip", () => {
    for (const p of plates) {
      const edge = p.nailEdge as Float32Array;
      expect(edge).toHaveLength(p.vertexCount);
      for (const e of edge) {
        expect(e).toBeGreaterThanOrEqual(-1e-6);
        expect(e).toBeLessThanOrEqual(1 + 1e-6);
      }
      const over = edge.filter((e) => e < 0.1).length / edge.length;
      const free = edge.filter((e) => e > 0.9).length / edge.length;
      // Most of a plate lies over its bed; the free edge is a narrow rim.
      expect(over, p.kind).toBeGreaterThan(0.5);
      expect(free, p.kind).toBeGreaterThan(0.02);
      expect(free, p.kind).toBeLessThan(0.35);
    }
    expect(topology.attachments.find((a) => a.kind === "teeth")?.nailEdge).toBeUndefined();
  });

  it("are drawn translucent over the bed and nearly opaque along the free edge", () => {
    for (const kind of NAIL_PLATE_KINDS) {
      const m = createAttachmentMaterial(kind, {
        color: [1, 1, 1],
        roughness: 0.5,
        texture: null,
        transparent: false,
        alphaToCoverage: false,
        backfaceCull: true,
      });
      expect(m).toBeInstanceOf(NailPlateMaterial);
      expect(m.transparent).toBe(true);
    }
    expect(NAIL_PLATE_OPACITY).toBeLessThan(0.3);
    expect(NAIL_FREE_EDGE_OPACITY).toBeGreaterThan(0.7);
  });
});
