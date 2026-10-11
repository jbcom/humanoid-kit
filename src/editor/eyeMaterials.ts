/**
 * The creator's eye texture choice, as plain functions: what the eye pack offers
 * (`humanoid-kit-eyes`, `EyeLibrary`) grouped and named for a picker, and the
 * recipe change that picking one makes. A material supplies an iris's pattern
 * and a sclera's detail, never its colour: `eyes.iris` and `eyes.scleraWarmth`
 * stay the recipe's.
 */
import type { EyeLibrary, EyeMaterialEntry } from "../eyes/library.ts";
import type { Recipe } from "../recipe/recipe.ts";

/** One material in a picker. */
export interface EyeMaterialChoice {
  id: string;
  /** What to call it in a list: "Diffuse amber eyes". */
  label: string;
  /** Whether the texture has an iris to speak of; a material without one is all sclera detail. */
  hasIris: boolean;
}

export interface EyeMaterialGroup {
  /** The pack's tag the group is: `human`, `slit pupil`, ... */
  kind: string;
  label: string;
  materials: EyeMaterialChoice[];
}

/** Headings for the pack's tags, in the order a picker lists them; a tag not named here follows, under its own name. */
const KINDS: readonly (readonly [string, string])[] = [
  ["human", "Human"],
  ["slit pupil", "Slit pupil"],
  ["toon", "Toon"],
  ["creature", "Creature"],
  ["blank", "Blank"],
];
/** Where a material with no tag at all is listed. */
const UNTAGGED = "other";

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The name of a material for a list: its title, less the author's name the title
 * was built from ("Bobby 03 diffuse amber eyes" by `bobby_03` is "Diffuse amber
 * eyes"), with a capital. A title that does not begin with its author's name, or is
 * nothing but it, is kept whole.
 */
export function eyeMaterialLabel(entry: Pick<EyeMaterialEntry, "title" | "author">): string {
  const words = entry.title.split(/\s+/).filter(Boolean);
  const author = alnum(entry.author);
  let spoken = "";
  let drop = 0;
  for (const [i, word] of words.entries()) {
    spoken += alnum(word);
    if (spoken === author) {
      drop = i + 1;
      break;
    }
    if (!author.startsWith(spoken)) break;
  }
  const rest = drop > 0 && drop < words.length ? words.slice(drop) : words;
  const text = rest.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The library's materials by kind, in the pack's own order: the kinds `KINDS` names
 * first, then any other tag, then materials with no tag. A material is listed under
 * its first tag only.
 */
export function eyeMaterialGroups(library: EyeLibrary): EyeMaterialGroup[] {
  const groups = new Map<string, EyeMaterialGroup>();
  const headings = new Map<string, string>(KINDS);
  for (const m of library.manifest.materials) {
    const kind = m.tags[0] ?? UNTAGGED;
    let group = groups.get(kind);
    if (!group) {
      group = { kind, label: headings.get(kind) ?? capitalised(kind), materials: [] };
      groups.set(kind, group);
    }
    group.materials.push({ id: m.id, label: eyeMaterialLabel(m), hasIris: m.hasIris });
  }
  const rank = (kind: string) => {
    const i = KINDS.findIndex(([k]) => k === kind);
    return i >= 0 ? i : kind === UNTAGGED ? Number.MAX_SAFE_INTEGER : KINDS.length;
  };
  return [...groups.values()].sort((a, b) => rank(a.kind) - rank(b.kind));
}

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * `recipe` wearing the eye material `id`, or the built-in eye for `null` (the recipe
 * then has no `material` key, as one saved before eye materials existed). The iris
 * colour and the sclera's warmth stay, and the input is not modified.
 */
export function withEyeMaterial(recipe: Recipe, id: string | null): Recipe {
  const { material: _material, ...eyes } = recipe.eyes;
  return { ...recipe, eyes: id === null ? eyes : { ...eyes, material: id } };
}
