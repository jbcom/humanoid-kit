/**
 * Where a figure's tattoos and marks lie (docs/ARCHITECTURE.md, "Body art"):
 * each anchor resolved to a frame on the figure's morphed control mesh, which
 * the per-figure body-art texture is baked from. The frame is the plane the
 * decal is projected along: its centre on the skin, the skin's outward normal
 * there, and the decal's right and up directions in that plane.
 */
import { quadVertexNormals } from "../build/normals.ts";
import type { HumanoidAssets } from "../format/assetFormat.ts";
import type { Vec3 } from "../presence/presence.ts";
import { type BirthmarkKind, type BodyArtRecipe, isBodyPiercingSite } from "../recipe/bodyArt.ts";
import { holeFrame, type PlacedPiercing, TISSUE_DEPTH } from "./jewellery.ts";
import { bodySites, resolveAnchor } from "./sites.ts";
import { vitiligoPatches } from "./vitiligo.ts";

export interface DecalFrame {
  /** On the skin, metres, in the figure's rest space. */
  centre: Vec3;
  /** The skin's outward unit normal at the centre. */
  normal: Vec3;
  /** Unit direction of the decal's +x (its right, looking at the skin). */
  right: Vec3;
  /** Unit direction of the decal's +y (its top). */
  up: Vec3;
}

export interface PlacedTattoo extends DecalFrame {
  image: string;
  /** Metres across; the height follows the image's aspect. */
  width: number;
  density: number;
}

export interface PlacedMark extends DecalFrame {
  kind: "scar" | BirthmarkKind | "vitiligo";
  /** Metres along the decal's up (a scar's length, a birthmark's size). */
  length: number;
  /** Metres along its right; negative mirrors the outline (a patch's image on the other side). */
  width: number;
  /** A scar's maturity (0 fresh, 1 mature); 1 for other marks. */
  maturity: number;
  /** A scar's raise; 0 for other marks. */
  raised: number;
  /** Seeds an irregular outline. */
  seed: number;
}

/**
 * A figure's body art resolved onto its shape: tattoos and marks ready to
 * bake (vitiligo's patches are among the marks), and piercings ready to build.
 */
export interface BodyArtPlacement {
  tattoos: PlacedTattoo[];
  marks: PlacedMark[];
  piercings: PlacedPiercing[];
}

const BODY_UP: Vec3 = [0, 1, 0];
/** Facing up or down (a shoulder's top), the body's forward stands in for its up. */
const BODY_FORWARD: Vec3 = [0, 0, 1];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * The frame at `centre` with outward `normal`, turned `rotation` degrees
 * counter-clockwise looking at the skin. Unturned, its up is the body's up laid
 * into the skin's plane (the body's forward where the skin faces up or down),
 * and its right is up × normal, the viewer's right.
 */
export function decalFrame(centre: Vec3, normal: Vec3, rotation: number): DecalFrame {
  const n = unit(normal);
  const reference = Math.abs(dot(n, BODY_UP)) > 0.95 ? BODY_FORWARD : BODY_UP;
  const along = dot(reference, n);
  const up0 = unit([
    reference[0] - n[0] * along,
    reference[1] - n[1] * along,
    reference[2] - n[2] * along,
  ]);
  const right0 = cross(up0, n);
  const a = (rotation * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return {
    centre: [...centre] as Vec3,
    normal: n,
    right: [0, 1, 2].map((k) => c * (right0[k] as number) + s * (up0[k] as number)) as Vec3,
    up: [0, 1, 2].map((k) => -s * (right0[k] as number) + c * (up0[k] as number)) as Vec3,
  };
}

/** The unit normal of the control mesh at base vertex `v`. */
function controlNormal(normals: Float32Array, v: number): Vec3 {
  return unit([
    normals[v * 3] as number,
    normals[v * 3 + 1] as number,
    normals[v * 3 + 2] as number,
  ]);
}

/**
 * The figure's body art placed on its morphed control mesh (`control`, base
 * topology). Throws `RangeError` for an anchor that names no site or vertex.
 */
export function placeBodyArt(
  assets: HumanoidAssets,
  art: BodyArtRecipe,
  control: Float32Array,
): BodyArtPlacement {
  const normals = quadVertexNormals(control, assets.faceVerts);
  const frame = (at: BodyArtRecipe["tattoos"][number]["at"], rotation: number) => {
    const v = resolveAnchor(assets, at);
    const centre: Vec3 = [
      control[v * 3] as number,
      control[v * 3 + 1] as number,
      control[v * 3 + 2] as number,
    ];
    return decalFrame(centre, controlNormal(normals, v), rotation);
  };
  return {
    tattoos: art.tattoos.map((t) => ({
      ...frame(t.at, t.rotation),
      image: t.image,
      width: t.size,
      density: t.density,
    })),
    marks: [
      ...art.scars.map((s) => ({
        ...frame(s.at, s.rotation),
        kind: "scar" as const,
        length: s.length,
        width: s.width,
        maturity: s.maturity,
        raised: s.raised,
        seed: 0,
      })),
      ...art.birthmarks.map((b) => ({
        ...frame(b.at, b.rotation),
        kind: b.kind,
        length: b.size,
        width: b.size,
        maturity: 1,
        raised: 0,
        seed: b.seed,
      })),
      ...(art.vitiligo ? vitiligoPatches(assets, art.vitiligo) : []).flatMap((p) =>
        p.vertices.map((v, side) => ({
          // Each side's outline is the other's mirror image: turned the other way.
          ...frame(v, 0),
          kind: "vitiligo" as const,
          length: p.size,
          width: side ? -p.size : p.size,
          maturity: 1,
          raised: 0,
          seed: p.seed,
        })),
      ),
    ],
    piercings: art.piercings.map((p) => {
      if (!isBodyPiercingSite(p.site))
        throw new RangeError(
          `piercing site ${p.site} is not one of the body's; the adult anatomy pack names no sites yet`,
        );
      const site = bodySites(assets)[p.site];
      const v = site.vertex;
      const hole: Vec3 = [
        control[v * 3] as number,
        control[v * 3 + 1] as number,
        control[v * 3 + 2] as number,
      ];
      const normal = controlNormal(normals, v);
      const skin = (a: ArrayLike<number>) =>
        [0, 1, 2, 3].map((k) => a[v * 4 + k] as number) as [number, number, number, number];
      return {
        ...p,
        hole,
        normal,
        ...holeFrame(hole, normal, site.channel, TISSUE_DEPTH[p.site]),
        skinIndex: skin(assets.skinIndex),
        skinWeight: skin(assets.skinWeight),
      };
    }),
  };
}
