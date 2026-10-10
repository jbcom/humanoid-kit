import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isCc0 } from "../scripts/lib/licenceRule.ts";
import {
  EYE_PACKS,
  IRIS_LUMINANCE_SCALE,
  measureEye,
  referenceEye,
  relativeTo,
  sample,
} from "../scripts/lib/packEyes.ts";
import { createEyeLibrary, type EyeManifest } from "../src/eyes/library.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { recipeProblems } from "../src/recipe/validate.ts";

const PACK = path.resolve(import.meta.dirname, "../packs/eyes/data");
const BODY = path.resolve(import.meta.dirname, "../packs/body/data");
const manifest = JSON.parse(
  fs.readFileSync(path.join(PACK, "manifest.json"), "utf8"),
) as EyeManifest;
const provenance = fs.readFileSync(path.join(PACK, "PROVENANCE.md"), "utf8");

describe("the eye pack", () => {
  it("holds the 32 CC0 materials of the community's two eye packs, each once, with a page that says CC0", () => {
    expect(manifest.version).toBe(1);
    expect(manifest.materials).toHaveLength(32);
    const ids = manifest.materials.map((m) => m.id);
    expect(new Set(ids).size).toBe(32);
    for (const id of [
      "nyloseth_green_cat_eyes",
      "hatshj_reptile_eyes",
      "bobby_03_diffuse_blue_eyes",
    ])
      expect(ids, id).toContain(id);
    for (const m of manifest.materials) {
      expect(isCc0(m.source.licence), m.id).toBe(true);
      expect(m.source.page, m.id).toMatch(/^http:\/\/www\.makehumancommunity\.org\/node\/\d+$/);
      expect(
        EYE_PACKS.map((p) => p.sha256),
        m.id,
      ).toContain(m.source.archiveSha256);
      expect(provenance, m.id).toMatch(new RegExp(`- ${m.id}: clause B; B: page licence "CC0"`));
    }
    // The CC-BY pack is not used.
    expect(provenance).toContain("system_eye_materials03` is CC-BY");
    expect(JSON.stringify(manifest)).not.toContain("materials03");
  });

  it("is what its manifest says: each texture's hash, a 1024 px WebP with the cornea cut in its alpha", async () => {
    const sharp = (await import("sharp")).default;
    for (const m of manifest.materials) {
      const bytes = fs.readFileSync(path.join(PACK, m.file));
      expect(createHash("sha256").update(bytes).digest("hex"), m.id).toBe(m.sha256);
      expect(provenance, m.id).toContain(m.sha256);
      const info = await sharp(bytes).metadata();
      expect([info.format, info.width, info.height, info.hasAlpha], m.id).toEqual([
        "webp",
        1024,
        1024,
        true,
      ]);
    }
  });

  it("measures from the pixels: the iris centres sit on the built-in texture's pupils, and the measure is the same on the built-in as on itself", async () => {
    const ref = await referenceEye(BODY);
    expect(relativeTo(ref, ref)).toMatchObject({
      irisGain: 1,
      scleraGain: 1,
      scleraTint: [1, 1, 1],
    });
    // The darkest pixels around each manifest centre are the pupil: within 3 px of the centre.
    const s = await sample(path.join(BODY, "eyes_high-poly_brown_eye.webp"));
    for (const [u, v] of manifest.centres) {
      const cx = u * 512;
      const cy = (1 - v) * 512;
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let y = Math.floor(cy - 30); y < cy + 30; y++)
        for (let x = Math.floor(cx - 30); x < cx + 30; x++) {
          const i = y * 512 + x;
          const lum = 0.2126 * (s.rgb[i * 3] as number) + 0.7152 * (s.rgb[i * 3 + 1] as number);
          if (lum < 0.004) {
            sx += x;
            sy += y;
            n++;
          }
        }
      expect(n).toBeGreaterThan(200);
      expect(Math.hypot(sx / n - cx, sy / n - cy)).toBeLessThan(3);
    }
  });

  it("keeps the colour model: whatever a material's texture, its iris shows the recipe's colour at the built-in's mean brightness, and a human one shows no sclera tint", async () => {
    const ref = await referenceEye(BODY);
    for (const m of manifest.materials.filter((x) => x.hasIris && !x.tags.includes("creature"))) {
      const s = await sample(path.join(PACK, m.file));
      const here = measureEye(s);
      // The shader's iris multiplier: nine times the texture's luminance times the material's gain.
      const multiplier = IRIS_LUMINANCE_SCALE * m.irisGain * here.irisLum;
      const builtIn = IRIS_LUMINANCE_SCALE * ref.irisLum;
      expect(multiplier / builtIn, `${m.id}: iris mean`).toBeGreaterThan(0.85);
      expect(multiplier / builtIn, `${m.id}: iris mean`).toBeLessThan(1.15);
      if (m.tags.includes("human"))
        for (const c of m.scleraTint) {
          expect(c, `${m.id}: tint`).toBeGreaterThan(0.55);
          expect(c, `${m.id}: tint`).toBeLessThan(1.45);
        }
    }
  });

  it("is a library by id, with a texture by file, and refuses an id it does not have", () => {
    const lib = createEyeLibrary(manifest, (f) => `/eyes/${f}`);
    expect(lib.entry("nyloseth_green_cat_eyes")?.tags).toContain("slit pupil");
    expect(lib.textureUrl("nyloseth_green_cat_eyes")).toBe("/eyes/nyloseth_green_cat_eyes.webp");
    expect(lib.entry("nope")).toBeUndefined();
    expect(() => lib.textureUrl("nope")).toThrow(/no eye material nope/);
  });
});

describe("a recipe's eye material", () => {
  it("is optional (a recipe without one is the built-in eye), kept by createRecipe, and a non-empty string when given", () => {
    expect(createRecipe().eyes).not.toHaveProperty("material");
    const r = createRecipe({ eyes: { material: "hatshj_reptile_eyes" } });
    expect(r.eyes.material).toBe("hatshj_reptile_eyes");
    expect(recipeProblems(r)).toEqual([]);
    const bad = structuredClone(r) as unknown as { eyes: { material: unknown } };
    bad.eyes.material = 3;
    expect(recipeProblems(bad)).toContain("eyes.material must be a non-empty string");
    bad.eyes.material = "";
    expect(recipeProblems(bad)).toContain("eyes.material must be a non-empty string");
  });
});
