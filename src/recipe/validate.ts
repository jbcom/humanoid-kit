/**
 * Structural validation for recipes, which usually arrive as JSON from saves,
 * URLs or other tools. A recipe that is wrong is rejected with every problem
 * listed; nothing is silently clamped or dropped.
 */
import { DEFAULT_MACROS } from "../makehuman/macro.ts";
import { BODY_REGIONS } from "../makehuman/regions.ts";
import {
  BEARD_STYLES,
  BODY_HAIR_GROUPS,
  MAX_BEARD_VOLUME,
  MAX_BODY_HAIR_DENSITY,
  MAX_BODY_HAIR_FOLLICLE_DENSITY,
  MIN_BODY_HAIR_FOLLICLE_DENSITY,
} from "../surface/bodyHair.ts";
import { bodyArtProblems } from "./bodyArt.ts";
import { DEFAULT_SKIN, RECIPE_VERSION, type Recipe } from "./recipe.ts";

export class RecipeValidationError extends Error {
  override name = "RecipeValidationError";
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`invalid recipe: ${problems.join("; ")}`);
    this.problems = problems;
  }
}

const MACRO_KEYS = new Set(Object.keys(DEFAULT_MACROS));
const SKIN_NUMBER_KEYS = Object.keys(DEFAULT_SKIN).filter((k) => k !== "override");
const REGIONS = new Set<string>(BODY_REGIONS);
const HAIR_PIGMENT_KEYS = ["eumelanin", "pheomelanin", "grey"] as const;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function recipeProblems(recipe: unknown): string[] {
  const p: string[] = [];
  if (typeof recipe !== "object" || recipe === null) return ["recipe is not an object"];
  const r = recipe as Partial<Recipe> & Record<string, unknown>;
  if (r.version !== RECIPE_VERSION) p.push(`version must be ${RECIPE_VERSION}`);

  if (typeof r.macros !== "object" || r.macros === null) p.push("macros missing");
  else {
    const macros = r.macros as unknown as Record<string, unknown>;
    for (const k of MACRO_KEYS)
      if (!finite(macros[k])) p.push(`macros.${k} must be a finite number`);
    for (const k of Object.keys(macros))
      if (!MACRO_KEYS.has(k)) p.push(`macros.${k} is not a macro`);
  }

  if (typeof r.regionalMacros !== "object" || r.regionalMacros === null)
    p.push("regionalMacros missing");
  else {
    for (const [region, values] of Object.entries(r.regionalMacros)) {
      if (!REGIONS.has(region)) p.push(`regionalMacros.${region} is not a body region`);
      if (typeof values !== "object" || values === null) {
        p.push(`regionalMacros.${region} must be an object`);
        continue;
      }
      for (const [k, v] of Object.entries(values)) {
        if (k === "age") p.push(`regionalMacros.${region}.age: age applies to the whole figure`);
        else if (!MACRO_KEYS.has(k)) p.push(`regionalMacros.${region}.${k} is not a macro`);
        else if (!finite(v)) p.push(`regionalMacros.${region}.${k} must be a finite number`);
      }
    }
  }

  if (typeof r.modifiers !== "object" || r.modifiers === null) p.push("modifiers missing");
  else
    for (const [id, v] of Object.entries(r.modifiers))
      if (!finite(v)) p.push(`modifiers.${id} must be a finite number`);

  if (typeof r.skin !== "object" || r.skin === null) p.push("skin missing");
  else {
    const s = r.skin as unknown as Record<string, unknown>;
    for (const k of SKIN_NUMBER_KEYS)
      if (!finite(s[k])) p.push(`skin.${k} must be a finite number`);
    const o = s.override;
    if (
      o !== null &&
      !(Array.isArray(o) && o.length === 3 && o.every((c) => finite(c) && c >= 0 && c <= 1))
    ) {
      p.push("skin.override must be null or three numbers in [0, 1]");
    }
  }
  if (typeof r.eyes !== "object" || r.eyes === null) p.push("eyes missing");
  else {
    const e = r.eyes as unknown as Record<string, unknown>;
    const iris = e.iris;
    if (
      !(
        Array.isArray(iris) &&
        iris.length === 3 &&
        iris.every((c) => finite(c) && c >= 0 && c <= 1)
      )
    ) {
      p.push("eyes.iris must be three numbers in [0, 1]");
    }
    if (!finite(e.scleraWarmth)) p.push("eyes.scleraWarmth must be a finite number");
    if (
      "material" in e &&
      e.material !== undefined &&
      !(typeof e.material === "string" && e.material !== "")
    )
      p.push("eyes.material must be a non-empty string");
  }
  if ("hair" in r && r.hair !== undefined) hairProblems(r.hair, p);
  if ("bodyHair" in r && r.bodyHair !== undefined) bodyHairProblems(r.bodyHair, p);
  if (r.bodyArt !== undefined) bodyArtProblems(r.bodyArt, p);
  if (r.outfit !== undefined) {
    if (!Array.isArray(r.outfit)) p.push("outfit must be an array of garment ids");
    else {
      const seen = new Set<unknown>();
      r.outfit.forEach((id: unknown, i) => {
        if (typeof id !== "string" || id === "") p.push(`outfit[${i}] must be a garment id`);
        else if (seen.has(id)) p.push(`outfit names ${id} twice`);
        seen.add(id);
      });
    }
  }
  if (r.outfitLook !== undefined) outfitLookProblems(r.outfitLook, p);
  return p;
}

const LOOK_FIELDS = new Set(["tint", "roughness", "wear"]);

function outfitLookProblems(looks: unknown, p: string[]): void {
  if (typeof looks !== "object" || looks === null || Array.isArray(looks)) {
    p.push("outfitLook must be an object of garment ids to looks");
    return;
  }
  for (const [id, look] of Object.entries(looks)) {
    const at = `outfitLook.${id}`;
    if (typeof look !== "object" || look === null || Array.isArray(look)) {
      p.push(`${at} must be an object`);
      continue;
    }
    const l = look as Record<string, unknown>;
    for (const k of Object.keys(l)) if (!LOOK_FIELDS.has(k)) p.push(`${at} has unknown field ${k}`);
    if (
      l.tint !== undefined &&
      !(
        Array.isArray(l.tint) &&
        l.tint.length === 3 &&
        l.tint.every((c) => typeof c === "number" && Number.isFinite(c) && c >= 0)
      )
    )
      p.push(`${at}.tint must be three finite numbers ≥ 0`);
    if (l.roughness !== undefined && !unit(l.roughness))
      p.push(`${at}.roughness must be in [0, 1]`);
    if (l.wear !== undefined && !unit(l.wear)) p.push(`${at}.wear must be in [0, 1]`);
  }
}

const HAIR_KEYS = new Set(["style", "colour", "brows", "lashes"]);
const unit = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;

/** The optional `hair` field: a style id or null, and a colour whose every value is in range. */
function hairProblems(hair: unknown, p: string[]): void {
  if (typeof hair !== "object" || hair === null) {
    p.push("hair must be an object");
    return;
  }
  const h = hair as Record<string, unknown>;
  for (const k of Object.keys(h)) if (!HAIR_KEYS.has(k)) p.push(`hair.${k} is not a hair field`);
  if (h.style !== null && !(typeof h.style === "string" && h.style !== ""))
    p.push("hair.style must be null or a non-empty string");
  // Brows and lashes are worn when named and absent otherwise: never null, never empty.
  for (const k of ["brows", "lashes"] as const)
    if (k in h && !(typeof h[k] === "string" && h[k] !== ""))
      p.push(`hair.${k} must be a non-empty string when given`);
  if (typeof h.colour !== "object" || h.colour === null) {
    p.push("hair.colour missing");
    return;
  }
  const c = h.colour as Record<string, unknown>;
  for (const k of HAIR_PIGMENT_KEYS)
    if (!unit(c[k])) p.push(`hair.colour.${k} must be a number in [0, 1]`);
  const o = c.override;
  if (o !== null && !(Array.isArray(o) && o.length === 3 && o.every(unit)))
    p.push("hair.colour.override must be null or three numbers in [0, 1]");
}

const BODY_HAIR_KEYS = new Set(["density", "coverage", "follicleDensity", "beard"]);
const GROUPS = new Set<string>(BODY_HAIR_GROUPS);
const BEARDS = new Set<string>(BEARD_STYLES);

/** The optional `bodyHair` field: compatible legacy multipliers, explicit controls and a beard style. */
function bodyHairProblems(bodyHair: unknown, p: string[]): void {
  if (typeof bodyHair !== "object" || bodyHair === null) {
    p.push("bodyHair must be an object");
    return;
  }
  const b = bodyHair as Record<string, unknown>;
  for (const k of Object.keys(b))
    if (!BODY_HAIR_KEYS.has(k)) p.push(`bodyHair.${k} is not a body hair field`);
  const numericMap = (
    field: "density" | "coverage" | "follicleDensity",
    min: number,
    max: number,
  ) => {
    const map = b[field];
    if (map === undefined) return;
    if (typeof map !== "object" || map === null) {
      p.push(`bodyHair.${field} must be an object`);
      return;
    }
    for (const [g, v] of Object.entries(map)) {
      if (!GROUPS.has(g)) p.push(`bodyHair.${field}.${g} is not a body hair group`);
      else if (!(finite(v) && v >= min && v <= max))
        p.push(`bodyHair.${field}.${g} must be a number in [${min}, ${max}]`);
    }
  };
  numericMap("density", 0, MAX_BODY_HAIR_DENSITY);
  numericMap("coverage", 0, 1);
  numericMap("follicleDensity", MIN_BODY_HAIR_FOLLICLE_DENSITY, MAX_BODY_HAIR_FOLLICLE_DENSITY);
  if (
    typeof b.density === "object" &&
    b.density !== null &&
    typeof b.coverage === "object" &&
    b.coverage !== null
  )
    for (const group of BODY_HAIR_GROUPS)
      if (group in b.density && group in b.coverage)
        p.push(`bodyHair.${group} cannot set both density and coverage`);
  if (b.beard !== undefined) beardProblems(b.beard, p);
}

const BEARD_KEYS = new Set(["style", "length", "volume", "grey", "fork", "part"]);

/**
 * `bodyHair.beard`: a known style, or an object with one and in-range
 * controls. Length is only checked non-negative here: the model clamps it to
 * the figure's chin height, which the recipe alone does not know.
 */
function beardProblems(beard: unknown, p: string[]): void {
  const styles = `one of ${BEARD_STYLES.join(", ")}`;
  if (typeof beard === "string") {
    if (!BEARDS.has(beard)) p.push(`bodyHair.beard must be ${styles}`);
    return;
  }
  if (typeof beard !== "object" || beard === null || Array.isArray(beard)) {
    p.push(`bodyHair.beard must be ${styles}, or an object with a style`);
    return;
  }
  const s = beard as Record<string, unknown>;
  for (const k of Object.keys(s))
    if (!BEARD_KEYS.has(k)) p.push(`bodyHair.beard.${k} is not a beard field`);
  if (!(typeof s.style === "string" && BEARDS.has(s.style)))
    p.push(`bodyHair.beard.style must be ${styles}`);
  if (s.length !== undefined && !(finite(s.length) && s.length >= 0))
    p.push("bodyHair.beard.length must be a number of metres, at least 0");
  if (
    s.volume !== undefined &&
    !(finite(s.volume) && s.volume >= 0 && s.volume <= MAX_BEARD_VOLUME)
  )
    p.push(`bodyHair.beard.volume must be a number in [0, ${MAX_BEARD_VOLUME}]`);
  for (const k of ["grey", "fork", "part"] as const)
    if (s[k] !== undefined && !unit(s[k])) p.push(`bodyHair.beard.${k} must be a number in [0, 1]`);
}

export function assertValidRecipe(recipe: unknown): asserts recipe is Recipe {
  const p = recipeProblems(recipe);
  if (p.length) throw new RecipeValidationError(p);
}
