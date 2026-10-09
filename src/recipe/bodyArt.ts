/**
 * Body art in a recipe (docs/ARCHITECTURE.md, "Body art"): tattoos, piercings,
 * scars, birthmarks and vitiligo. The recipe's `bodyArt` field is optional and
 * absent means none, so recipes without body art serialise exactly as before.
 *
 * Everything is placed on the body by a `BodyAnchor`: a named site
 * (`BODY_SITES`, src/bodyArt/sites.ts) or a base-mesh vertex, so a placement
 * follows the figure through every shape and pose. Sizes are metres on the
 * figure's skin. A tattoo's image is a key the application resolves when it
 * renders, so the recipe stays plain JSON.
 */

/** A named body site (`BODY_SITES`) or the index of a base-mesh vertex. */
export type BodyAnchor = string | number;

export interface Tattoo {
  /** Key of the image the application supplies when it renders (`BodyArtImages`). */
  image: string;
  /** Where the image's centre lies. */
  at: BodyAnchor;
  /** Width of the image on the skin, metres; its height follows the image's aspect. */
  size: number;
  /** Degrees counter-clockwise, looking at the skin, from the body's up. */
  rotation: number;
  /** 0..1: how much ink the dermis holds (1 fresh and saturated, lower faded). */
  density: number;
}

/**
 * The body's piercing sites, each found on the base mesh (src/bodyArt/sites.ts).
 * Any other site is one the adult anatomy pack names, and is adult-only
 * (`agePolicyViolations`): the core names no adult anatomy.
 */
export const PIERCING_SITES = [
  "ear-lobe.L",
  "ear-lobe.R",
  "ear-helix.L",
  "ear-helix.R",
  "nostril.L",
  "nostril.R",
  "septum",
  "brow.L",
  "brow.R",
  "lower-lip",
  "navel",
] as const;
export type PiercingSite = (typeof PIERCING_SITES)[number];

/** Whether a piercing site is one of the body's own (`PIERCING_SITES`), not the adult pack's. */
export const isBodyPiercingSite = (site: string): site is PiercingSite =>
  (PIERCING_SITES as readonly string[]).includes(site);

/** Jewellery shapes. */
export const JEWELLERY = ["stud", "ring", "barbell"] as const;
export type Jewellery = (typeof JEWELLERY)[number];

/** Jewellery metals (`metalReflectance`, src/bodyArt/piercings.ts). */
export const METALS = ["steel", "titanium", "gold", "rose-gold", "silver"] as const;
export type Metal = (typeof METALS)[number];

export interface Piercing {
  /** A piercing site (`PIERCING_SITES`, or one the adult anatomy pack names). */
  site: string;
  jewellery: Jewellery;
  metal: Metal;
  /** Metres: a stud's head, a ring's outer diameter, a barbell's length. */
  size: number;
}

/** Default jewellery sizes, metres (CHOICE: typical retail sizes). */
export const JEWELLERY_SIZE: Readonly<Record<Jewellery, number>> = {
  stud: 0.003,
  ring: 0.01,
  barbell: 0.014,
};

export interface Scar {
  at: BodyAnchor;
  /** Metres along the scar. */
  length: number;
  /** Metres across it. */
  width: number;
  /** Degrees counter-clockwise from the body's up. */
  rotation: number;
  /** 0 = fresh (red, raised), 1 = mature (pale, flat). */
  maturity: number;
  /** 0..1: how raised (hypertrophic) the scar is. */
  raised: number;
}

/** Birthmarks, by what is in the skin (docs/research/BODY-ART.md, A4). */
export const BIRTHMARKS = ["cafe-au-lait", "naevus", "port-wine", "dermal-melanocytosis"] as const;
export type BirthmarkKind = (typeof BIRTHMARKS)[number];

export interface Birthmark {
  kind: BirthmarkKind;
  at: BodyAnchor;
  /** Metres across the mark. */
  size: number;
  /** Degrees; an irregular mark's outline turns with it. */
  rotation: number;
  /** Seeds the outline (deterministic). */
  seed: number;
}

export interface Vitiligo {
  /** 0..1: how much of the typical sites (face, hands, feet, joints) is depigmented. */
  extent: number;
  /** Seeds where the patches lie (deterministic). */
  seed: number;
}

export interface BodyArtRecipe {
  tattoos: Tattoo[];
  piercings: Piercing[];
  scars: Scar[];
  birthmarks: Birthmark[];
  /** Absent means no vitiligo. */
  vitiligo?: Vitiligo;
}

/** What `createRecipe` accepts: each item with any defaulted field left out. */
export interface BodyArtInit {
  tattoos?: readonly (Pick<Tattoo, "image" | "at" | "size"> & Partial<Tattoo>)[];
  piercings?: readonly (Pick<Piercing, "site"> & Partial<Piercing>)[];
  scars?: readonly (Pick<Scar, "at" | "length"> & Partial<Scar>)[];
  birthmarks?: readonly (Pick<Birthmark, "kind" | "at" | "size"> & Partial<Birthmark>)[];
  vitiligo?: Partial<Vitiligo>;
}

/** A scar's default width, metres (CHOICE: a healed surgical incision). */
export const SCAR_WIDTH = 0.003;

/** A full `BodyArtRecipe` from `init`, defaults filled in. */
export function createBodyArt(init: BodyArtInit): BodyArtRecipe {
  return {
    tattoos: (init.tattoos ?? []).map((t) => ({
      image: t.image,
      at: t.at,
      size: t.size,
      rotation: t.rotation ?? 0,
      density: t.density ?? 1,
    })),
    piercings: (init.piercings ?? []).map((p) => {
      const jewellery = p.jewellery ?? "stud";
      return {
        site: p.site,
        jewellery,
        metal: p.metal ?? "steel",
        size: p.size ?? JEWELLERY_SIZE[jewellery],
      };
    }),
    scars: (init.scars ?? []).map((s) => ({
      at: s.at,
      length: s.length,
      width: s.width ?? SCAR_WIDTH,
      rotation: s.rotation ?? 0,
      maturity: s.maturity ?? 1,
      raised: s.raised ?? 0,
    })),
    birthmarks: (init.birthmarks ?? []).map((b) => ({
      kind: b.kind,
      at: b.at,
      size: b.size,
      rotation: b.rotation ?? 0,
      seed: b.seed ?? 0,
    })),
    ...(init.vitiligo && {
      vitiligo: { extent: init.vitiligo.extent ?? 0.3, seed: init.vitiligo.seed ?? 0 },
    }),
  };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const unit = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;
/** Metres a placed feature may span: more than nothing, less than a figure. */
const span = (v: unknown): v is number => finite(v) && v > 0 && v <= 2;
const anchor = (v: unknown): v is BodyAnchor =>
  (typeof v === "string" && v !== "") || (Number.isInteger(v) && (v as number) >= 0);

function fields(
  item: unknown,
  path: string,
  keys: readonly string[],
  p: string[],
): Record<string, unknown> | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    p.push(`${path} must be an object`);
    return null;
  }
  const o = item as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!keys.includes(k)) p.push(`${path}.${k} is not a field`);
  return o;
}

function list(
  value: unknown,
  path: string,
  p: string[],
  each: (item: unknown, at: string) => void,
): void {
  if (!Array.isArray(value)) {
    p.push(`${path} must be an array`);
    return;
  }
  value.forEach((item, i) => {
    each(item, `${path}[${i}]`);
  });
}

/**
 * Every problem with a recipe's `bodyArt`, appended to `p`. Structure only:
 * whether a site or vertex exists is checked against the loaded assets when
 * the figure is evaluated (`resolveAnchor`).
 */
export function bodyArtProblems(value: unknown, p: string[]): void {
  const art = fields(
    value,
    "bodyArt",
    ["tattoos", "piercings", "scars", "birthmarks", "vitiligo"],
    p,
  );
  if (!art) return;
  list(art.tattoos, "bodyArt.tattoos", p, (item, at) => {
    const t = fields(item, at, ["image", "at", "size", "rotation", "density"], p);
    if (!t) return;
    if (!(typeof t.image === "string" && t.image !== ""))
      p.push(`${at}.image must be an image key`);
    if (!anchor(t.at)) p.push(`${at}.at must be a site name or a vertex index`);
    if (!span(t.size)) p.push(`${at}.size must be metres in (0, 2]`);
    if (!finite(t.rotation)) p.push(`${at}.rotation must be a finite number`);
    if (!unit(t.density)) p.push(`${at}.density must be a number in [0, 1]`);
  });
  const sites = new Set<unknown>();
  list(art.piercings, "bodyArt.piercings", p, (item, at) => {
    const q = fields(item, at, ["site", "jewellery", "metal", "size"], p);
    if (!q) return;
    if (!(typeof q.site === "string" && q.site !== "")) p.push(`${at}.site must be a site name`);
    else if (sites.has(q.site)) p.push(`${at}: site ${q.site} is pierced twice`);
    sites.add(q.site);
    if (!JEWELLERY.includes(q.jewellery as Jewellery))
      p.push(`${at}.jewellery must be one of ${JEWELLERY.join(", ")}`);
    if (!METALS.includes(q.metal as Metal))
      p.push(`${at}.metal must be one of ${METALS.join(", ")}`);
    if (!(finite(q.size) && q.size > 0 && q.size <= 0.05))
      p.push(`${at}.size must be metres in (0, 0.05]`);
  });
  list(art.scars, "bodyArt.scars", p, (item, at) => {
    const s = fields(item, at, ["at", "length", "width", "rotation", "maturity", "raised"], p);
    if (!s) return;
    if (!anchor(s.at)) p.push(`${at}.at must be a site name or a vertex index`);
    if (!span(s.length)) p.push(`${at}.length must be metres in (0, 2]`);
    if (!span(s.width)) p.push(`${at}.width must be metres in (0, 2]`);
    if (!finite(s.rotation)) p.push(`${at}.rotation must be a finite number`);
    if (!unit(s.maturity)) p.push(`${at}.maturity must be a number in [0, 1]`);
    if (!unit(s.raised)) p.push(`${at}.raised must be a number in [0, 1]`);
  });
  list(art.birthmarks, "bodyArt.birthmarks", p, (item, at) => {
    const b = fields(item, at, ["kind", "at", "size", "rotation", "seed"], p);
    if (!b) return;
    if (!BIRTHMARKS.includes(b.kind as BirthmarkKind))
      p.push(`${at}.kind must be one of ${BIRTHMARKS.join(", ")}`);
    if (!anchor(b.at)) p.push(`${at}.at must be a site name or a vertex index`);
    if (!span(b.size)) p.push(`${at}.size must be metres in (0, 2]`);
    if (!finite(b.rotation)) p.push(`${at}.rotation must be a finite number`);
    if (!Number.isInteger(b.seed)) p.push(`${at}.seed must be an integer`);
  });
  if (art.vitiligo !== undefined) {
    const v = fields(art.vitiligo, "bodyArt.vitiligo", ["extent", "seed"], p);
    if (v) {
      if (!unit(v.extent)) p.push("bodyArt.vitiligo.extent must be a number in [0, 1]");
      if (!Number.isInteger(v.seed)) p.push("bodyArt.vitiligo.seed must be an integer");
    }
  }
}
