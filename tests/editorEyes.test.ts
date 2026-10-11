import { describe, expect, it } from "vitest";
import { eyeMaterialGroups, withEyeMaterial } from "../src/editor/eyeMaterials.ts";
import { createEyeLibrary, type EyeManifest } from "../src/eyes/library.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { eyeManifest } from "./fixtures.ts";

const library = createEyeLibrary(eyeManifest, (file) => file);

/** The words of an author's or a source's name that must not lead a label. */
const sourceWords = (m: EyeManifest["materials"][number]) =>
  [m.author, m.source.archive.replace(/\.zip$/, ""), ...m.id.split("_").slice(0, 1)]
    .flatMap((s) => s.toLowerCase().split(/[^a-z]+/))
    .filter((w) => w.length > 2);

describe("the eye pack's labels", () => {
  const materials = library.manifest.materials;

  it("gives every material a curated, non-empty label that is not its file name", () => {
    for (const m of materials) {
      expect(m.label, m.id).toBe(m.label.trim());
      expect(m.label.length, m.id).toBeGreaterThan(2);
      expect(m.label.length, m.id).toBeLessThanOrEqual(16);
      expect(m.label, m.id).toMatch(/^[A-Z]/);
      expect(m.label.toLowerCase(), m.id).not.toBe(m.title.toLowerCase());
    }
  });

  it("is unique within its group, which is what a picker lists together", () => {
    for (const group of eyeMaterialGroups(library)) {
      const labels = group.materials.map((m) => m.label);
      expect(new Set(labels).size, `${group.label}: ${labels.join(", ")}`).toBe(labels.length);
    }
  });

  it("has no underscore, digit-only suffix, or author or source prefix", () => {
    for (const m of materials) {
      expect(m.label, m.id).not.toMatch(/[_]/);
      expect(m.label, m.id).not.toMatch(/\d+$/);
      expect(m.label, m.id).not.toMatch(/\b0\d\b/);
      const first = m.label.toLowerCase().split(/\s+/)[0] ?? "";
      expect(sourceWords(m), `${m.id}: "${m.label}"`).not.toContain(first);
    }
  });

  it("comes from the pack's manifest unchanged, not from a rewrite of the title", () => {
    const listed = eyeMaterialGroups(library).flatMap((g) => g.materials);
    for (const m of materials) expect(listed.find((c) => c.id === m.id)?.label, m.id).toBe(m.label);
  });
});

describe("eyeMaterialGroups", () => {
  it("lists every material once, under its first tag, in the order a picker reads", () => {
    const groups = eyeMaterialGroups(library);
    expect(groups.map((g) => g.kind)).toEqual(["human", "slit pupil", "toon", "creature", "blank"]);
    expect(groups.map((g) => g.label)).toEqual([
      "Human",
      "Slit pupil",
      "Toon",
      "Creature",
      "Blank",
    ]);
    const ids = groups.flatMap((g) => g.materials.map((m) => m.id));
    expect([...ids].sort()).toEqual(library.manifest.materials.map((m) => m.id).sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(32);
    const slit = groups.find((g) => g.kind === "slit pupil");
    expect(slit?.materials.map((m) => m.id)).toContain("nyloseth_yellow_cat_eyes");
    expect(groups.find((g) => g.kind === "blank")?.materials.map((m) => m.id)).not.toContain(
      "nyloseth_yellow_cat_eyes",
    );
  });

  it("keeps the pack's order inside a group and says which materials have no iris", () => {
    const human = eyeMaterialGroups(library).find((g) => g.kind === "human");
    const order = library.manifest.materials.filter((m) => m.tags[0] === "human").map((m) => m.id);
    expect(human?.materials.map((m) => m.id)).toEqual(order);
    const dragon = eyeMaterialGroups(library)
      .flatMap((g) => g.materials)
      .find((m) => m.id === "bobby_03_daz_dragon_eyes");
    expect(dragon?.hasIris).toBe(false);
  });

  it("lists a tag it does not know after the known ones, and an untagged material last", () => {
    const base = library.manifest.materials[0] as EyeManifest["materials"][number];
    const manifest: EyeManifest = {
      ...library.manifest,
      materials: [
        { ...base, id: "plain", title: "Plain", tags: [] },
        { ...base, id: "odd", title: "Odd", tags: ["glowing"] },
        { ...base, id: "kind", title: "Kind", tags: ["human"] },
      ],
    };
    expect(
      eyeMaterialGroups(createEyeLibrary(manifest, (f) => f)).map((g) => [g.kind, g.label]),
    ).toEqual([
      ["human", "Human"],
      ["glowing", "Glowing"],
      ["other", "Other"],
    ]);
  });
});

describe("withEyeMaterial", () => {
  const r = createRecipe({ eyes: { iris: [0.05, 0.1, 0.25], scleraWarmth: 0.8 } });

  it("wears a material and keeps the colours, the rest of the recipe and the input", () => {
    const before = structuredClone(r);
    const out = withEyeMaterial(r, "bobby_03_diffuse_blue_eyes");
    expect(out.eyes).toEqual({
      iris: [0.05, 0.1, 0.25],
      scleraWarmth: 0.8,
      material: "bobby_03_diffuse_blue_eyes",
    });
    expect({ ...out, eyes: r.eyes }).toEqual(r);
    expect(r).toEqual(before);
  });

  it("changes one material for another, and leaves no key for the built-in eye", () => {
    const worn = withEyeMaterial(r, "bobby_03_diffuse_blue_eyes");
    expect(withEyeMaterial(worn, "nyloseth_green_cat_eyes").eyes.material).toBe(
      "nyloseth_green_cat_eyes",
    );
    const back = withEyeMaterial(worn, null);
    expect("material" in back.eyes).toBe(false);
    expect(back).toEqual(r);
  });
});
