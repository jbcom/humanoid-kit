import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The counts the documents state (modifiers, targets, hair entries, eye materials,
 * clips, garments, packages) must equal what the packs' manifests hold, so a
 * regenerated pack that changes a count fails here until the prose follows.
 */

const root = resolve(import.meta.dirname, "..");
/** A file's text with every run of whitespace as one space, so line wrapping does not matter. */
const read = (path: string): string =>
  readFileSync(resolve(root, path), "utf8").replace(/\s+/g, " ");

interface Modifiers {
  modifiers: { id: string }[];
  sliders: { groups: { sliders: { id: string }[] }[] }[];
}
interface BodyManifest extends Modifiers {
  targets: { id: string; entries: unknown }[];
}
interface AdultManifest extends Modifiers {
  targets: { entries: unknown };
}
const manifest = <T>(pack: string): T =>
  JSON.parse(readFileSync(resolve(root, `packs/${pack}/data/manifest.json`), "utf8"));

const body = manifest<BodyManifest>("body");
const adult = manifest<AdultManifest>("adult-anatomy");
const hair = manifest<{ styles: { kind: string }[] }>("hair");
const eyes = manifest<{ materials: unknown[] }>("eyes");
const animations = manifest<{ clips: unknown[] }>("animations");
const clothing = manifest<{ garments: { entries: unknown } }>("clothing");

const sliderIds = (m: Modifiers): Set<string> => {
  const ids = new Set<string>();
  for (const tab of m.sliders)
    for (const group of tab.groups) for (const s of group.sliders) ids.add(s.id);
  return ids;
};
const entryCount = (entries: unknown): number =>
  Array.isArray(entries) ? entries.length : Object.keys(entries as object).length;
const hairKind = (kind: string): number =>
  hair.styles.filter((s: { kind: string }) => s.kind === kind).length;

const adultSliders = sliderIds(adult);
const counts = {
  bodyModifiers: body.modifiers.length,
  adultModifiers: adult.modifiers.length,
  allModifiers: body.modifiers.length + adult.modifiers.length,
  adultWithSliders: adult.modifiers.filter((m: { id: string }) => adultSliders.has(m.id)).length,
  adultLegacy: adult.modifiers.filter((m: { id: string }) => !adultSliders.has(m.id)).length,
  adultTargets: entryCount(adult.targets.entries),
  bodyTargets: body.targets.reduce(
    (n: number, t: { entries: unknown }) => n + entryCount(t.entries),
    0,
  ),
  bodyModifierTargets: entryCount(body.targets.find((t) => t.id === "modifiers")?.entries ?? []),
  hairEntries: hair.styles.length,
  scalp: hairKind("scalp"),
  brows: hairKind("brows"),
  lashes: hairKind("lashes"),
  eyeMaterials: eyes.materials.length,
  clips: animations.clips.length,
  garments: entryCount(clothing.garments.entries),
};

/** Every document that states a count, and the phrases it must carry. */
const phrases: Record<string, string[]> = {
  "README.md": [
    `${counts.bodyModifiers} shape modifiers`,
    `${counts.allModifiers} shape modifiers`,
    `${counts.adultTargets} adult-only targets and ${counts.adultModifiers} modifiers (${counts.adultWithSliders} with sliders; ${counts.adultLegacy} retained legacy ids`,
    `${counts.hairEntries} hair entries`,
    `${counts.scalp} scalp styles`,
    `${counts.brows} eyebrows, ${counts.lashes} eyelashes`,
    `${counts.eyeMaterials} eye materials`,
    `${counts.clips} clips`,
    `${counts.garments} garments`,
  ],
  "docs/introduction.md": [
    `${counts.bodyModifiers} shape modifiers`,
    `${counts.allModifiers} shape modifiers`,
    `${counts.adultTargets} adult-only targets and ${counts.adultModifiers} modifiers (${counts.adultWithSliders} with sliders; ${counts.adultLegacy} retained legacy ids`,
    `${counts.hairEntries} hair entries`,
    `${counts.scalp} scalp styles, ${counts.brows} eyebrows, ${counts.lashes} eyelashes`,
    `${counts.eyeMaterials} eye materials`,
    `${counts.clips} clips`,
    `${counts.garments} garments`,
  ],
  "llms.txt": [
    `${counts.bodyModifiers} shape modifiers`,
    `${counts.adultTargets} adult-only targets and ${counts.adultModifiers} modifiers (${counts.adultWithSliders} with sliders; ${counts.adultLegacy} retained legacy ids)`,
    `${counts.hairEntries} hair entries`,
    `${counts.scalp} scalp styles, ${counts.brows} eyebrows, ${counts.lashes} eyelashes`,
    `${counts.eyeMaterials} eye materials`,
    `${counts.clips} clips`,
    `${counts.garments} garments`,
  ],
  "docs/ARCHITECTURE.md": [
    `${counts.bodyTargets} sparse targets (${counts.bodyTargets - counts.bodyModifierTargets} macro and skin-mask targets, ${counts.bodyModifierTargets} modifier targets)`,
    `${counts.bodyModifiers} shape modifiers`,
    `${counts.adultTargets} adult-only targets and ${counts.adultModifiers} adult-only modifiers; ${counts.adultWithSliders} have sliders and ${counts.adultLegacy}`,
    `${counts.clips} clips`,
    `${counts.eyeMaterials} CC0 eye materials`,
    `${counts.hairEntries} hair entries`,
    `${counts.scalp} scalp styles, ${counts.brows} eyebrows, ${counts.lashes} eyelashes`,
    `${counts.garments} garments`,
  ],
  "packs/hair/README.md": [
    `${counts.hairEntries} alpha-card entries`,
    `${counts.scalp} scalp styles`,
    `${counts.brows} eyebrows, ${counts.lashes} eyelashes`,
  ],
  "packs/hair/package.json": [
    `${counts.scalp} scalp styles, ${counts.brows} eyebrows, ${counts.lashes} eyelashes`,
  ],
  "packs/eyes/package.json": [`${counts.eyeMaterials} irises and sclerae`],
  "packs/animations/package.json": [`${counts.clips} clips`],
  "packs/animations/README.md": [`${counts.clips} clips`],
};

/** Stale counts and phrases that earlier revisions of these documents carried. */
const stale: Record<string, RegExp[]> = {
  "README.md": [
    /\b233\b|\b238\b|\b280 shape/,
    /\bten scalp/i,
    /four packages/,
    /\b19 (MakeHuman )?garments/,
  ],
  "docs/introduction.md": [/\b233\b|\b238\b/, /\bten scalp/i, /not implemented yet/],
  "llms.txt": [/\bten scalp/i, /\b90 clips/, /\b19 (MakeHuman )?garments/],
  "docs/ARCHITECTURE.md": [/\b853 sparse/, /10 adult-only targets and 5/, /\bTen scalp/],
};

describe("documented counts match the pack manifests", () => {
  it("counts the adult pack's modifiers as the slider-bearing ones plus the retained legacy ids", () => {
    expect(counts.adultWithSliders + counts.adultLegacy).toBe(counts.adultModifiers);
    expect(counts.scalp + counts.brows + counts.lashes).toBeLessThan(counts.hairEntries);
  });

  for (const [file, wanted] of Object.entries(phrases)) {
    const text = read(file);
    for (const phrase of wanted) {
      it(`${file} says "${phrase}"`, () => {
        expect(text).toContain(phrase);
      });
    }
  }

  for (const [file, patterns] of Object.entries(stale)) {
    const text = read(file);
    for (const pattern of patterns) {
      it(`${file} no longer says ${pattern}`, () => {
        expect(text).not.toMatch(pattern);
      });
    }
  }

  it("names every published package in the README table and in NOTICE.md", () => {
    const readme = read("README.md");
    const notice = read("NOTICE.md");
    for (const pack of ["body", "adult-anatomy", "hair", "eyes", "animations", "clothing"]) {
      expect(readme).toContain(`\`packs/${pack}\``);
      expect(notice).toContain(`\`packs/${pack}/\``);
    }
    expect(readme).toContain("publishes seven packages");
  });
});
