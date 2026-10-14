/**
 * Miniatures (docs/MINIATURES.md): a dressed recipe baked once into a few
 * hundred triangles per level of detail, with its poses or animation clips as
 * per-vertex frames, for drawing hundreds of figures of an archetype in one
 * instanced call.
 *
 * The figure is posed by the kit's own CPU skinning for every frame
 * (`poseFigure`), welded part by part, decimated once over sample frames of
 * every clip (`decimate`), so every level is a subset of the full vertices and
 * a frame is a gather; colours are baked per vertex from the skin tone, the
 * garments' textures and the scalp hair. No rendering dependency: it runs in
 * Node, a worker or a page, and the result is plain typed arrays.
 */
import { type AnimationClip, sampleClip } from "../animation/clip.ts";
import { BODY_REGIONS, type BodyRegion } from "../makehuman/regions.ts";
import type { HumanoidModel } from "../model/humanoidModel.ts";
import { boundProxy } from "../model/proxy.ts";
import type { Recipe } from "../recipe/recipe.ts";
import { type BoneRotations, IDENTITY_POSE, rigData } from "../rig/pose.ts";
import { agedHairColour, DEFAULT_HAIR_COLOUR, hairAlbedo, hairTint } from "../surface/hairTone.ts";
import { linearToSrgb, skinAlbedo, srgbToLinear } from "../surface/skinTone.ts";
import { decimate } from "./decimate.ts";
import { type FigureBody, type FigurePartRest, figureAtRest, poseFigure } from "./figure.ts";

export class MiniatureError extends Error {
  override name = "MiniatureError";
}

/** A decoded RGBA8 image, rows top first (`ImageData`'s layout). */
export interface DecodedTexture {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** A clip to bake, sampled at `fps` (default `MINIATURE_FPS`). */
export interface MiniatureClipSource {
  /** The name the runtime plays it by. */
  name: string;
  clip: AnimationClip;
  fps?: number;
}

export interface MiniatureOptions {
  /** The body's mesh: a proxy id (default `"proxy741"`) or `"surface"` for the full render surface. */
  body?: FigureBody;
  /** The static casting's pose when no clips are given (default: the rest pose). */
  pose?: BoneRotations;
  /** Clips to bake as frames; none bakes the one static pose. */
  clips?: readonly MiniatureClipSource[];
  /** Triangle counts per level of detail, nearest first (default `MINIATURE_LODS`). */
  lods?: readonly number[];
  /** How many frames, spread over every clip, the decimation weighs (default 8). */
  samplePoses?: number;
  /**
   * A garment's decoded diffuse texture (named by `material.texture`, at
   * `textureUrl` when the assets were loaded with URLs), or null to use the
   * material colour alone. Decoding is the caller's: `sharp` in Node, an
   * `OffscreenCanvas` in a page or worker. All textures are decoded before the
   * bake, which is synchronous.
   */
  texture?: (part: Pick<FigurePartRest, "id" | "material" | "textureUrl">) => DecodedTexture | null;
  /**
   * Preserve every selected `recipe.facialHair` source card as a separate,
   * lossless alpha-card payload. The caller must provide the decoded RGBA
   * source texture for every selected facial part through `texture`.
   *
   * Omitted by default: the opaque miniature mesh remains unchanged. This is
   * not an alpha-to-solid conversion for distant painted miniatures.
   */
  facialHair?: "alpha-cards";
}

/** The issue's budget: about 1,500 triangles near and 400 far. */
export const MINIATURE_LODS: readonly number[] = [1500, 400];
/** Frames per second clips are sampled at by default. */
export const MINIATURE_FPS = 15;

/**
 * Per-instance tint channels a vertex can take (`MiniatureBake.channel`): skin
 * is never tinted; a garment's vertex takes the upper or lower channel by the
 * body region it covers, and hats and shoes their own.
 */
export const TINT_CHANNELS = ["skin", "upper", "lower", "accessory"] as const;
export type TintChannel = (typeof TINT_CHANNELS)[number];

/** A clip's frames within `MiniatureBake.positions`. */
export interface MiniatureClip {
  name: string;
  /** First frame (row) of the clip. */
  start: number;
  frames: number;
  fps: number;
  loop: boolean;
}

/** A baked archetype: one vertex set, an index per level, and its frames. */
export interface MiniatureBake {
  /** What stood for the body (`"proxy741"`, `"base"`...). */
  body: string;
  vertexCount: number;
  /**
   * Per level, nearest first: the triangle count asked for, the triangles over
   * the shared vertices, and the level's own normals (`frameCount × vertexCount
   * × 3`, unit): a vertex's normal at a level is the mean over everything merged
   * into it there.
   */
  lods: { target: number; index: Uint32Array; normals: Float32Array }[];
  /** Per vertex, sRGB colour, three bytes. */
  colour: Uint8Array;
  /** Per vertex, its `TINT_CHANNELS` index. */
  channel: Uint8Array;
  frameCount: number;
  /** `frameCount × vertexCount × 3` positions (metres, standing on y = 0). */
  positions: Float32Array;
  /** The clips' frame ranges; empty for a static casting (one frame). */
  clips: MiniatureClip[];
  /** Bounds over every frame. */
  min: [number, number, number];
  max: [number, number, number];
  /**
   * Optional selected facial attachments, retained outside the decimated opaque
   * mesh with their exact source topology, UV seams and RGBA strand map.
   */
  alphaCards?: MiniatureAlphaCard[];
}

/** A selected authored facial source card carried losslessly beside an opaque miniature bake. */
export interface MiniatureAlphaCard {
  /** The hair-pack style id. */
  id: string;
  vertexCount: number;
  /** Exact source triangle topology, one index per corner. */
  index: Uint32Array;
  /** Exact source UVs: no welding crosses a UV seam. */
  uvs: Float32Array;
  /** One skinned, ground-lifted position and normal for every bake frame. */
  positions: Float32Array;
  normals: Float32Array;
  /** The source strand texture embedded in the bake; no runtime URL is needed. */
  texture: { width: number; height: number; rgba: Uint8Array };
  /** The selected figure hair colour, as the live strand material's linear tint. */
  tint: [number, number, number];
}

/** How much more a region's vertices cost to remove: the face and hands read at small size. */
const REGION_IMPORTANCE: Partial<Record<BodyRegion, number>> = {
  head: 6,
  neck: 2,
  hands: 3,
  feet: 1.5,
};
/** Garment kinds whose vertices take the accessory channel and cost more (a brim reads at any size). */
const ACCESSORY_KINDS = new Set(["hat", "shoes"]);
const LOWER_REGIONS = new Set<BodyRegion>(["pelvis", "legs", "feet"]);
/**
 * How firmly a part's open borders hold their line (`DecimateInput.boundaryWeight`):
 * a garment's hems, cuffs and brims are its silhouette; the body's borders are
 * the sockets and the edges the outfit cut, which nobody sees as a line.
 */
const BORDER_WEIGHT: Record<FigurePartRest["role"], number> = {
  body: 0.25,
  garment: 4,
  attachment: 1,
  facialHair: 1,
};

/** One part welded: the part vertices kept (shown, one per rest position) and each one's welded index. */
function weldPart(part: FigurePartRest): { keep: number[]; local: Int32Array } {
  const n = part.rest.length / 3;
  const used = new Uint8Array(n);
  for (const v of part.index) used[v] = 1;
  const local = new Int32Array(n).fill(-1);
  const byPosition = new Map<string, number>();
  const keep: number[] = [];
  for (let v = 0; v < n; v++) {
    if (!used[v]) continue;
    const key = `${part.rest[v * 3]},${part.rest[v * 3 + 1]},${part.rest[v * 3 + 2]}`;
    let w = byPosition.get(key);
    if (w === undefined) {
      w = keep.length;
      keep.push(v);
      byPosition.set(key, w);
    }
    local[v] = w;
  }
  return { keep, local };
}

/** Bilinear sample of a texture at (u, v), v up (OpenGL's convention), as linear RGB. */
function sampleLinear(t: DecodedTexture, u: number, v: number): [number, number, number] {
  // Repeat outside [0, 1] only: an edge's 1 is the far edge, not the near one.
  const wrap = (c: number) => (c >= 0 && c <= 1 ? c : c - Math.floor(c));
  const x = wrap(u) * t.width - 0.5;
  const y = (1 - wrap(v)) * t.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const out: [number, number, number] = [0, 0, 0];
  for (const [dx, dy, w] of [
    [0, 0, (1 - fx) * (1 - fy)],
    [1, 0, fx * (1 - fy)],
    [0, 1, (1 - fx) * fy],
    [1, 1, fx * fy],
  ] as const) {
    const px = Math.min(t.width - 1, Math.max(0, x0 + dx));
    const py = Math.min(t.height - 1, Math.max(0, y0 + dy));
    const o = (py * t.width + px) * 4;
    for (let k = 0; k < 3; k++)
      out[k] = (out[k] as number) + w * srgbToLinear(t.data[o + k] as number);
  }
  return out;
}

/** The frames to bake: each clip sampled at its rate (a loop without its repeated end), or the one pose. */
function bakeFrames(
  options: MiniatureOptions,
  bones: number,
): { rotations: BoneRotations[]; clips: MiniatureClip[] } {
  const sources = options.clips ?? [];
  if (!sources.length) return { rotations: [options.pose ?? IDENTITY_POSE(bones)], clips: [] };
  if (options.pose) throw new MiniatureError("bake either a static pose or clips, not both");
  const rotations: BoneRotations[] = [];
  const clips: MiniatureClip[] = [];
  const names = new Set<string>();
  for (const s of sources) {
    if (names.has(s.name)) throw new MiniatureError(`clip ${s.name} is named twice`);
    names.add(s.name);
    const fps = s.fps ?? MINIATURE_FPS;
    if (!(fps > 0)) throw new MiniatureError(`clip ${s.name}: fps must be positive`);
    const span = Math.round(s.clip.duration * fps);
    const frames = Math.max(1, s.clip.loop ? span : span + 1);
    clips.push({ name: s.name, start: rotations.length, frames, fps, loop: s.clip.loop });
    for (let i = 0; i < frames; i++)
      rotations.push(sampleClip(s.clip, i / fps, IDENTITY_POSE(bones)));
  }
  return { rotations, clips };
}

/** Bakes `recipe` (worn garments, skin, scalp hair) into a `MiniatureBake`; see the module comment. */
export function bakeMiniature(
  model: HumanoidModel,
  recipe: Recipe,
  options: MiniatureOptions = {},
): MiniatureBake {
  if (model.assets.adultAnatomyLoaded)
    throw new MiniatureError(
      "miniatures never carry the adult anatomy pack: bake with a model built without it (docs/MINIATURES.md)",
    );
  const lods = options.lods ?? MINIATURE_LODS;
  if (!lods.length) throw new MiniatureError("a bake needs at least one level of detail");
  if (lods.some((n, k) => !(n > 0) || (k > 0 && n > (lods[k - 1] as number))))
    throw new MiniatureError(
      "levels of detail are positive triangle counts, nearest (largest) first",
    );
  const body = options.body ?? "proxy741";
  const rig = rigData(model.assets);
  const { rotations, clips } = bakeFrames(options, rig.bones.length);
  // The eyes fill the body's sockets; teeth and tongue are inside a closed mouth.
  const preserveFacialHair = options.facialHair === "alpha-cards";
  const rest = figureAtRest(model, recipe, {
    body,
    attachments: ["eyes"],
    facialHair: preserveFacialHair,
  });
  const opaqueParts = rest.parts.filter((part) => part.role !== "facialHair");
  const facialParts = rest.parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.role === "facialHair");

  // Weld each opaque part and lay the parts end to end. Facial source cards
  // stay separate: their seams and texture coordinates must never be welded
  // into the opaque miniature surface.
  const welded = opaqueParts.map(weldPart);
  const offsets: number[] = [];
  let total = 0;
  for (const w of welded) {
    offsets.push(total);
    total += w.keep.length;
  }
  const index: number[] = [];
  opaqueParts.forEach((p, i) => {
    const { local } = welded[i] as ReturnType<typeof weldPart>;
    const o = offsets[i] as number;
    for (let t = 0; t < p.index.length; t += 3) {
      const a = local[p.index[t] as number] as number;
      const b = local[p.index[t + 1] as number] as number;
      const c = local[p.index[t + 2] as number] as number;
      // A triangle welded flat (two corners at one rest position) is dropped.
      if (a !== b && b !== c && c !== a) index.push(o + a, o + b, o + c);
    }
  });

  // Every frame, posed whole and gathered into the welded numbering.
  const F = rotations.length;
  const positions = new Float32Array(F * total * 3);
  const normals = new Float32Array(F * total * 3);
  const wornColour = agedHairColour(
    recipe.hair?.colour ?? DEFAULT_HAIR_COLOUR,
    recipe.macros.age,
    "scalp",
  );
  const facialCards = facialParts.map(({ part, index }) => {
    if (!part.uvs || !part.material)
      throw new MiniatureError(`facial hair ${part.id} has no source UV/material data`);
    const texture = options.texture?.(part);
    if (!texture)
      throw new MiniatureError(
        `facial hair ${part.id} needs its decoded RGBA source texture for alpha-card preservation`,
      );
    if (
      !Number.isInteger(texture.width) ||
      !Number.isInteger(texture.height) ||
      texture.width < 1 ||
      texture.height < 1 ||
      texture.data.length !== texture.width * texture.height * 4
    )
      throw new MiniatureError(`facial hair ${part.id} has an invalid decoded RGBA source texture`);
    const tint = hairTint(wornColour);
    return {
      sourceIndex: index,
      card: {
        id: part.id,
        vertexCount: part.rest.length / 3,
        index: Uint32Array.from(part.index),
        uvs: Float32Array.from(part.uvs),
        positions: new Float32Array(F * part.rest.length),
        normals: new Float32Array(F * part.restNormals.length),
        texture: {
          width: texture.width,
          height: texture.height,
          rgba: Uint8Array.from(texture.data),
        },
        tint: [tint[0], tint[1], tint[2]],
      } satisfies MiniatureAlphaCard,
    };
  });
  const alphaCards = facialCards.map(({ card }) => card);
  rotations.forEach((r, f) => {
    const posed = poseFigure(rest, r);
    opaqueParts.forEach((_, i) => {
      const sourceIndex = rest.parts.indexOf(opaqueParts[i] as FigurePartRest);
      const p = posed.parts[sourceIndex] as (typeof posed.parts)[number];
      const { keep } = welded[i] as ReturnType<typeof weldPart>;
      const o = ((offsets[i] as number) + f * total) * 3;
      keep.forEach((v, k) => {
        for (let c = 0; c < 3; c++) {
          positions[o + k * 3 + c] = p.positions[v * 3 + c] as number;
          normals[o + k * 3 + c] = p.normals[v * 3 + c] as number;
        }
      });
    });
    facialCards.forEach(({ card, sourceIndex }) => {
      const p = posed.parts[sourceIndex] as (typeof posed.parts)[number];
      const o = f * card.vertexCount * 3;
      card.positions.set(p.positions, o);
      card.normals.set(p.normals, o);
    });
  });

  // Importance, tint channel and colour per welded vertex.
  const importance = new Float32Array(total);
  const borders = new Float32Array(total);
  const channel = new Uint8Array(total);
  const linear = new Float32Array(total * 3);
  const skin = skinAlbedo(recipe.skin);
  const scalp = scalpDensity(model, recipe);
  const bodyBase = bodyBaseWeights(model, rest.body);
  opaqueParts.forEach((p, i) => {
    const { keep } = welded[i] as ReturnType<typeof weldPart>;
    const o = offsets[i] as number;
    const accessory = ACCESSORY_KINDS.has(p.kind);
    const texture = p.role !== "body" && options.texture ? options.texture(p) : null;
    const tint = p.material?.color ?? [1, 1, 1];
    keep.forEach((v, k) => {
      const w = o + k;
      const region = BODY_REGIONS[p.bodyRegion[v] as number] as BodyRegion;
      importance[w] = (REGION_IMPORTANCE[region] ?? 1) * (accessory ? 2 : 1);
      borders[w] = BORDER_WEIGHT[p.role];
      let rgb: readonly number[];
      if (p.role === "body") {
        channel[w] = 0;
        const hair = scalp ? bodyBase(v, scalp.density) : 0;
        const h = Math.min(1, hair * 2);
        rgb = [0, 1, 2].map(
          (c) => (skin[c] as number) * (1 - h) + ((scalp?.albedo[c] as number) ?? 0) * h,
        );
      } else {
        // Attachments (the eyes) are never tinted; a garment by what it covers.
        channel[w] =
          p.role === "attachment" ? 0 : accessory ? 3 : LOWER_REGIONS.has(region) ? 2 : 1;
        const base =
          texture && p.uvs
            ? sampleLinear(texture, p.uvs[v * 2] as number, p.uvs[v * 2 + 1] as number)
            : [1, 1, 1];
        rgb = [0, 1, 2].map((c) => (base[c] as number) * (tint[c] as number));
      }
      for (let c = 0; c < 3; c++) linear[w * 3 + c] = rgb[c] as number;
    });
  });

  // Decimate over sample frames spread across every clip, the first always among them.
  const samples = Math.max(1, Math.min(F, options.samplePoses ?? 8));
  const sampleFrames = Array.from({ length: samples }, (_, s) =>
    positions.subarray(
      Math.floor((s * F) / samples) * total * 3,
      (Math.floor((s * F) / samples) + 1) * total * 3,
    ),
  );
  const levels = decimate({
    frames: sampleFrames,
    index: Uint32Array.from(index),
    importance,
    boundaryWeight: borders,
    targets: lods,
  });

  // The near level's vertices, in welded order, are the bake's vertex set.
  const first = levels[0] as (typeof levels)[number];
  const keptSet = new Uint8Array(total);
  for (const v of first.index) keptSet[v] = 1;
  const renumber = new Int32Array(total).fill(-1);
  let N = 0;
  for (let v = 0; v < total; v++) if (keptSet[v]) renumber[v] = N++;
  // Each kept vertex's colour is the mean, by the surface each stands for, of the
  // welded vertices merged into it: a dense band (a hem's stitching) counts for
  // its area, not for its many vertices.
  const area = vertexAreas(positions.subarray(0, total * 3), index);
  const sum = new Float64Array(N * 3);
  const count = new Float64Array(N);
  for (let v = 0; v < total; v++) {
    const r = renumber[first.owner[v] as number] as number;
    if (r < 0) continue;
    const a = area[v] as number;
    count[r] = (count[r] as number) + a;
    for (let c = 0; c < 3; c++)
      sum[r * 3 + c] = (sum[r * 3 + c] as number) + a * (linear[v * 3 + c] as number);
  }
  const colour = new Uint8Array(N * 3);
  const channels = new Uint8Array(N);
  for (let v = 0; v < total; v++) {
    const r = renumber[v] as number;
    if (r < 0) continue;
    channels[r] = channel[v] as number;
    for (let c = 0; c < 3; c++)
      colour[r * 3 + c] = linearToSrgb((sum[r * 3 + c] as number) / (count[r] as number));
  }
  const outPositions = new Float32Array(F * N * 3);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let f = 0; f < F; f++)
    for (let v = 0; v < total; v++) {
      const r = renumber[v] as number;
      if (r < 0) continue;
      for (let c = 0; c < 3; c++) {
        const p = positions[(f * total + v) * 3 + c] as number;
        outPositions[(f * N + r) * 3 + c] = p;
        min[c] = Math.min(min[c] as number, p);
        max[c] = Math.max(max[c] as number, p);
      }
    }
  for (const card of alphaCards)
    for (let i = 0; i < card.positions.length; i += 3)
      for (let c = 0; c < 3; c++) {
        const p = card.positions[i + c] as number;
        min[c] = Math.min(min[c] as number, p);
        max[c] = Math.max(max[c] as number, p);
      }
  return {
    body: rest.body,
    vertexCount: N,
    lods: levels.map((l) => ({
      target: l.target,
      index: Uint32Array.from(l.index, (v) => renumber[v] as number),
      normals: clusterNormals(normals, l.owner, renumber, F, total, N),
    })),
    colour,
    channel: channels,
    frameCount: F,
    positions: outPositions,
    clips,
    min,
    max,
    ...(alphaCards.length && { alphaCards }),
  };
}

/** A third of the area of every triangle round each vertex (never zero, so a mean always has a weight). */
function vertexAreas(positions: Float32Array, index: readonly number[]): Float64Array {
  const out = new Float64Array(positions.length / 3).fill(1e-12);
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t] as number, index[t + 1] as number, index[t + 2] as number];
    const d = (i: number, j: number, k: number) =>
      (positions[j * 3 + k] as number) - (positions[i * 3 + k] as number);
    const ux = d(a, b, 0);
    const uy = d(a, b, 1);
    const uz = d(a, b, 2);
    const vx = d(a, c, 0);
    const vy = d(a, c, 1);
    const vz = d(a, c, 2);
    const third = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 6;
    for (const v of [a, b, c]) out[v] = (out[v] as number) + third;
  }
  return out;
}

/**
 * A level's normals per frame: each kept vertex's is the mean of the full
 * normals of every vertex merged into it at that level, so a vertex that stands
 * for a patch is shaded as the patch faces, not as the one point it kept (a
 * socket's rim would darken half a face).
 */
function clusterNormals(
  normals: Float32Array,
  owner: Int32Array,
  renumber: Int32Array,
  F: number,
  total: number,
  N: number,
): Float32Array {
  const out = new Float32Array(F * N * 3);
  for (let f = 0; f < F; f++) {
    for (let v = 0; v < total; v++) {
      const r = renumber[owner[v] as number] as number;
      if (r < 0) continue;
      for (let c = 0; c < 3; c++)
        out[(f * N + r) * 3 + c] =
          (out[(f * N + r) * 3 + c] as number) + (normals[(f * total + v) * 3 + c] as number);
    }
    for (let r = 0; r < N; r++) {
      const o = (f * N + r) * 3;
      const l = Math.hypot(out[o] as number, out[o + 1] as number, out[o + 2] as number);
      if (l > 0) for (let c = 0; c < 3; c++) out[o + c] = (out[o + c] as number) / l;
      else out[o + 1] = 1;
    }
  }
  return out;
}

/** The scalp hair's density per base vertex (0..1) and albedo, or null for a figure without scalp hair. */
function scalpDensity(
  model: HumanoidModel,
  recipe: Recipe,
): { density: Float32Array; albedo: readonly number[] } | null {
  const id = recipe.hair?.style;
  if (!id) return null;
  const fields = model.assets.hair?.bound.get(id)?.hair;
  if (!fields) return null;
  const density = new Float32Array(model.assets.manifest.vertexCount);
  fields.scalpVerts.forEach((v, k) => {
    density[v] = (fields.scalpWeights[k] as number) / 255;
  });
  return { density, albedo: hairAlbedo((recipe.hair as NonNullable<Recipe["hair"]>).colour) };
}

/** For a body vertex, a base-vertex field's value there: through the render surface's base vertices, or a proxy's binding. */
function bodyBaseWeights(
  model: HumanoidModel,
  body: string,
): (v: number, field: Float32Array) => number {
  if (body === "base" || body === "adult") {
    const base = model.baseRenderVertices(body);
    return (v, field) => {
      const b = base[v] as number;
      return b >= 0 ? (field[b] as number) : 0;
    };
  }
  const proxy = boundProxy(model.assets, body);
  return (v, field) =>
    (proxy.weights[v * 3] as number) * (field[proxy.refVerts[v * 3] as number] as number) +
    (proxy.weights[v * 3 + 1] as number) * (field[proxy.refVerts[v * 3 + 1] as number] as number) +
    (proxy.weights[v * 3 + 2] as number) * (field[proxy.refVerts[v * 3 + 2] as number] as number);
}
