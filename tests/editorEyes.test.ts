import { describe, expect, it } from "vitest";
import {
  eyeMaterialGroups,
  eyeMaterialLabel,
  withEyeMaterial,
} from "../src/editor/eyeMaterials.ts";
import { createEyeLibrary, type EyeManifest } from "../src/eyes/library.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { eyeManifest } from "./fixtures.ts";

const library = createEyeLibrary(eyeManifest, (file) => file);
const labelOf = (id: string) => {
  const entry = library.entry(id);
  if (!entry) throw new Error(`the eye pack has no ${id}`);
  return eyeMaterialLabel(entry);
};

describe("eyeMaterialLabel", () => {
  it("drops the author's name the title was built from, and capitalises what is left", () => {
    expect(labelOf("bobby_03_diffuse_amber_eyes")).toBe("Diffuse amber eyes");
    expect(labelOf("bobby_03_daz_dragon_eyes")).toBe("Daz dragon eyes");
    expect(labelOf("hatshj_alien_eye_2")).toBe("Alien eye 2");
    expect(labelOf("wojackowl_blue_eyes_toon")).toBe("Blue eyes toon");
    expect(labelOf("mindfront_brown_eye_02")).toBe("Brown eye 02");
    expect(labelOf("culturalibre_6_eyes")).toBe("6 eyes");
  });

  it("keeps a title that does not begin with its author, or is only the author", () => {
    expect(eyeMaterialLabel({ title: "Blue sky eyes", author: "someone" })).toBe("Blue sky eyes");
    expect(eyeMaterialLabel({ title: "Someone", author: "someone" })).toBe("Someone");
    expect(eyeMaterialLabel({ title: "Some eyes", author: "someone else" })).toBe("Some eyes");
  });

  it("names every material of the shipped pack, each differently", () => {
    const labels = library.manifest.materials.map(eyeMaterialLabel);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label).toMatch(/^[A-Z0-9]/);
      expect(label.length).toBeGreaterThan(2);
    }
    for (const m of library.manifest.materials)
      expect(eyeMaterialLabel(m).toLowerCase().startsWith(m.author.toLowerCase())).toBe(false);
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
