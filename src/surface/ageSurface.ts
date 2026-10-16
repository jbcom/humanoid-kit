/**
 * Age surface: the creases an old face and the backs of the hands carry at rest.
 *
 * Fine lines are finer than the base mesh: a forehead line is a millimetre or
 * two across, the forehead's vertices a centimetre apart. A per-vertex field
 * cannot hold one (docs/research/AGE-SURFACE.md: the held per-vertex layers drew
 * spurious segments wherever neighbouring vertices fell to different lines). So
 * the creases are a texture in the body's own UV space, baked at pack time
 * (`scripts/lib/ageSurfaceMap.ts`) from the CC0 MakeHuman old-skin photographs,
 * which are painted in that same space. The neck stays neutral because these
 * photographs provide no reliable neck-crease signal. Sampled at the body's
 * UVs, the creases ride the mesh through every expression, pose and morph.
 *
 * The map is a signed crease height per texel (0.5 is flat, below is a groove),
 * one channel per source photograph: red the old man's, green the old woman's.
 * The skin shader mixes them by the gender macro, darkens the grooves a little
 * and tilts the normal by the height's gradient (`SkinMaterial.setAgeSurface`).
 */
import { ageAxis } from "../makehuman/macro.ts";

/** The map's file in the body pack. */
export const AGE_SURFACE_FILE = "age-surface.webp";
/** Its edge in texels: about 0.4 mm of face per texel. */
export const AGE_SURFACE_SIZE = 2048;

/**
 * How much of the old creases a figure of this age shows, 0..1: MakeHuman's own
 * weight of its old body at that age (`ageAxis`, 0 up to 25, rising linearly to
 * 1 at 90), so the skin ages on the clock the shape does. Absent age is the
 * default adult (25), which shows none.
 */
export function ageSurfaceStrength(age: number | undefined): number {
  if (age === undefined || !Number.isFinite(age)) return 0;
  for (const [anchor, weight] of ageAxis(age)) if (anchor === "old") return weight;
  return 0;
}

/**
 * Groove depth at full strength where the map is darkest, metres. Forehead and
 * periorbital wrinkles of the elderly measure 0.1 to 0.5 mm deep in skin
 * replicas (profilometry); the map's extremes are its deepest creases.
 */
export const AGE_CREASE_DEPTH = 0.0003;

/**
 * How much a full-depth groove darkens the skin at full strength (a share of its
 * colour): the shadowed floor of a crease, which reads on every tone as the
 * relief alone does not under flat light.
 */
export const AGE_CREASE_DARKEN = 0.18;

/** The map's mix for a figure: the gender macro (1 the old man's photograph, 0 the old woman's). */
export const ageSurfaceSex = (gender: number | undefined): number =>
  Math.min(1, Math.max(0, gender ?? 0.5));
