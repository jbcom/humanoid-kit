/**
 * The adult anatomy's piercing sites: data the adult pack declares
 * (`AdultAnatomySpec.piercingSites`), placed by the core on the evaluated adult
 * surface. A declared site resolves on an adult and follows the detail that
 * shapes it; a site nobody declares is refused; and none applies under 18.
 */
import { describe, expect, it } from "vitest";
import { AUTHORING_FIGURE } from "../scripts/lib/control/mound.ts";
import { jewelleryMesh } from "../src/bodyArt/jewellery.ts";
import {
  type AdultPiercingSiteSpec,
  AssetFormatError,
  type HumanoidAssets,
  parseHumanoidAssets,
} from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { agePolicyViolations } from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultPackData, bodyPackData, loadFixtureAssets } from "./fixtures.ts";

/** The shipped packs, the adult manifest's anatomy declaring `piercingSites`. */
function withSites(piercingSites: unknown, anatomy: object = {}): HumanoidAssets {
  const adult = adultPackData();
  const manifest = {
    ...adult.manifest,
    anatomy: { ...adult.manifest.anatomy, ...anatomy, piercingSites },
  } as typeof adult.manifest;
  return parseHumanoidAssets(bodyPackData(), { ...adult, manifest });
}

const SIZE = "genitals/phallus-size";
const probe = new HumanoidModel(loadFixtureAssets(true), { subdivision: 1 });
const lattice = probe.adultDetailLattice(AUTHORING_FIGURE);
if (!lattice) throw new Error("no adult surface");
const phallic = lattice.reservoirs.find((r) => r.id === "phallic");
if (!phallic) throw new Error("no phallic reservoir");
/** A test site at the phallic reservoir's last ring, which the detail carries furthest out. */
const SITE: AdultPiercingSiteSpec = {
  name: "test-site",
  vertex: phallic.base + (phallic.rings - 1) * phallic.loop,
  channel: "normal",
  depth: 0.004,
};
const pierced = (age: number, size: number, site = SITE.name) =>
  createRecipe({
    macros: { age, gender: 0.5 },
    modifiers: { [SIZE]: size },
    bodyArt: { piercings: [{ site, jewellery: "ring" }] },
  });

describe("a declared adult piercing site", { timeout: 300_000 }, () => {
  const model = new HumanoidModel(withSites([SITE]), { subdivision: 1 });

  it("resolves on an adult, on the drawn adult surface, and follows the detail there", () => {
    const at = (size: number) => {
      const ev = model.evaluate(pierced(30, size));
      expect(ev.surface).toBe("adult");
      const p = ev.bodyArt?.piercings[0];
      if (!p) throw new Error("not placed");
      // The hole is a vertex of the surface the figure is drawn with.
      let nearest = Number.POSITIVE_INFINITY;
      for (let v = 0; v < ev.positions.length / 3; v++)
        nearest = Math.min(
          nearest,
          Math.hypot(
            (ev.positions[v * 3] as number) - p.hole[0],
            (ev.positions[v * 3 + 1] as number) - p.hole[1],
            (ev.positions[v * 3 + 2] as number) - p.hole[2],
          ),
        );
      expect(nearest).toBeLessThan(1e-6);
      expect(Math.hypot(...p.normal)).toBeCloseTo(1, 5);
      expect(p.skinWeight.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 4);
      expect(jewelleryMesh(p).positions.every(Number.isFinite)).toBe(true);
      return p.hole;
    };
    const small = at(0.3);
    const large = at(1);
    // The larger phallus carries its last ring, and the hole with it, centimetres further.
    expect(
      Math.hypot(large[0] - small[0], large[1] - small[1], large[2] - small[2]),
    ).toBeGreaterThan(0.01);
  });

  it("is refused under 18, by the age policy and in evaluation", () => {
    const minor = pierced(16, 0.3);
    expect(agePolicyViolations(minor).join(" ")).toMatch(/test-site is adult-only/);
    expect(() => model.evaluate(minor)).toThrow();
  });

  it("is the pack's: a site it does not declare is refused, on any adult", () => {
    expect(() => model.evaluate(pierced(30, 0.3, "undeclared"))).toThrow(
      /neither the body's nor one the adult anatomy pack declares/,
    );
    expect(() => probe.evaluate(pierced(30, 0.3))).toThrow(RangeError);
  });
});

describe("declaring adult piercing sites", () => {
  it("refuses a declaration the core could not place", () => {
    const bad: [string, unknown, object?][] = [
      ["twice", [SITE, SITE]],
      ["the body's own name", [{ ...SITE, name: "navel" }]],
      ["an unknown channel", [{ ...SITE, channel: "sideways" }]],
      ["a vertex that is not an index", [{ ...SITE, vertex: 1.5 }]],
      ["no depth", [{ ...SITE, depth: 0 }]],
      ["too deep", [{ ...SITE, depth: 0.05 }]],
      ["no detail lattice", [SITE], { detail: undefined }],
    ];
    for (const [what, sites, anatomy] of bad)
      expect(() => withSites(sites, anatomy), what).toThrow(AssetFormatError);
  });

  it("refuses a vertex past the lattice once the adult surface is built", () => {
    const model = new HumanoidModel(withSites([{ ...SITE, vertex: lattice.vertexCount }]), {
      subdivision: 1,
    });
    expect(() => model.evaluate(createRecipe({ macros: { age: 30 } }))).toThrow(AssetFormatError);
  });
});
