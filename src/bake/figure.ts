/**
 * A whole dressed figure posed on the CPU, part by part, as the renderer draws
 * it (docs/MINIATURES.md): the body (its render surface, or a MakeHuman proxy
 * body fitted to it) with the triangles the outfit hides left out, then every
 * garment in `outfit.order` and any attachments asked for (the eyes), each
 * skinned by the kit's own skinning
 * (`skinPositions`: the shader's blend of linear and dual quaternion skinning,
 * with the hip and knee folds on the body surface) and lifted so the lowest point of the
 * figure stands on y = 0.
 *
 * `figureAtRest` evaluates once; `poseFigure` poses that rest figure for any
 * rotations without evaluating again, which is what a bake sampling many frames
 * needs. `posedFigure` is both in one call.
 */
import { type AttachmentMaterial, SKIN_INFLUENCES } from "../format/assetFormat.ts";
import { solvedFolds } from "../foundation/posed.ts";
import { BODY_REGIONS, regionOfBone } from "../makehuman/regions.ts";
import type { HumanoidModel } from "../model/humanoidModel.ts";
import { fitProxy, proxyIndex, proxyTopology } from "../model/proxy.ts";
import { skinOfEvaluation } from "../model/reservoirSkin.ts";
import type { Recipe } from "../recipe/recipe.ts";
import { heaviestBone } from "../rig/influences.ts";
import { type JointFold, renderFold } from "../rig/jointFold.ts";
import {
  type BoneRotations,
  posedGroundOffset,
  type RestBones,
  restBones,
  skinNormals,
  skinPositions,
} from "../rig/pose.ts";

/** Which mesh stands for the body: the render surface the evaluation gives, or a proxy body by id. */
export type FigureBody = "surface" | string;

export interface FigureOptions {
  /** The body's mesh: `"surface"` (default) or a proxy id (`PROXY_IDS`), whose proxies must be loaded. */
  body?: FigureBody;
  /**
   * Kinds of the body pack's attachments to include as parts after the
   * garments (`eyes`, `teeth`, `tongue`, nail plates), in the pack's order.
   * Default none.
   */
  attachments?: readonly string[];
  /**
   * Include the recipe's selected authored facial-hair attachments after the
   * requested body-pack attachments. This is opt-in because consumers that
   * turn a figure into an opaque mesh need to choose how to preserve the
   * source cards' UV seams and alpha texture.
   */
  facialHair?: boolean;
}

/** One part of a figure at rest: the body or a garment, with what posing it needs. */
export interface FigurePartRest {
  /** `"body"`, or the garment's or attachment's id. */
  id: string;
  /** `"body"`, the garment's category (`GARMENT_LAYERS`) or the attachment's kind. */
  kind: string;
  role: "body" | "garment" | "attachment" | "facialHair";
  /** Vertex positions at rest, model space, before any ground lift. */
  rest: Float32Array;
  restNormals: Float32Array;
  /** Triangles that show once the outfit is worn, three indices each. */
  index: Uint32Array;
  /** UV per vertex, or null for a part without one (a proxy body). */
  uvs: Float32Array | null;
  /** Four bone indices and weights per vertex. */
  skinIndex: Uint8Array | Uint16Array;
  skinWeight: Float32Array;
  /** Per vertex, its body region (an index into `BODY_REGIONS`): where on the body it sits, by its dominant bone. */
  bodyRegion: Uint8Array;
  /** The garment's material, or null for the body. */
  material: AttachmentMaterial | null;
  /** The garment's diffuse texture URL, when the assets were loaded with URLs. */
  textureUrl: string | null;
}

/** A figure evaluated once, ready to pose. */
export interface FigureRest {
  /** The body first, then each garment in `outfit.order`, then the attachments asked for. */
  parts: FigurePartRest[];
  /** What stands for the body: the evaluated surface (`"base"` or `"adult"`) or the proxy id. */
  body: string;
  bones: RestBones;
  /** Morphed control positions (base topology). */
  control: Float32Array;
  /** The joint folds (hip and knee) on the body surface; none for a proxy body. */
  folds: readonly JointFold[];
  /** What grounding needs (`posedGroundOffset`). */
  model: HumanoidModel;
}

/** A posed part: `positions` and `normals` lifted onto the ground with the whole figure. */
export interface FigurePart extends FigurePartRest {
  positions: Float32Array;
  normals: Float32Array;
}

export interface PosedFigure {
  parts: FigurePart[];
  body: string;
  bones: RestBones;
  rotations: BoneRotations;
  /** The lift applied to every part so the lowest point stands on y = 0 (metres). */
  groundOffset: number;
}

/** Per vertex, the region of the bone with the largest weight. */
function regionsOf(
  skinIndex: Uint8Array | Uint16Array,
  skinWeight: Float32Array,
  bones: readonly string[],
): Uint8Array {
  const byBone = Uint8Array.from(bones, (b) => BODY_REGIONS.indexOf(regionOfBone(b)));
  const n = skinWeight.length / SKIN_INFLUENCES;
  const out = new Uint8Array(n);
  for (let v = 0; v < n; v++) out[v] = byBone[heaviestBone(skinIndex, skinWeight, v)] as number;
  return out;
}

/** Area-weighted vertex normals of a triangle mesh. */
export function triangleNormals(positions: Float32Array, index: Uint32Array): Float32Array {
  const out = new Float32Array(positions.length);
  for (let t = 0; t < index.length; t += 3) {
    const a = (index[t] as number) * 3;
    const b = (index[t + 1] as number) * 3;
    const c = (index[t + 2] as number) * 3;
    const ux = (positions[b] as number) - (positions[a] as number);
    const uy = (positions[b + 1] as number) - (positions[a + 1] as number);
    const uz = (positions[b + 2] as number) - (positions[a + 2] as number);
    const vx = (positions[c] as number) - (positions[a] as number);
    const vy = (positions[c + 1] as number) - (positions[a + 1] as number);
    const vz = (positions[c + 2] as number) - (positions[a + 2] as number);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      out[v] = (out[v] as number) + nx;
      out[v + 1] = (out[v + 1] as number) + ny;
      out[v + 2] = (out[v + 2] as number) + nz;
    }
  }
  for (let v = 0; v < out.length; v += 3) {
    const l = Math.hypot(out[v] as number, out[v + 1] as number, out[v + 2] as number);
    if (l > 0) {
      out[v] = (out[v] as number) / l;
      out[v + 1] = (out[v + 1] as number) / l;
      out[v + 2] = (out[v + 2] as number) / l;
    } else out[v + 1] = 1;
  }
  return out;
}

/** The figure of `recipe` evaluated once, at rest, with every part's data for posing. */
export function figureAtRest(
  model: HumanoidModel,
  recipe: Recipe,
  options: FigureOptions = {},
): FigureRest {
  const bodyChoice = options.body ?? "surface";
  const ev = model.evaluate(recipe);
  // The evaluation's arrays are the model's scratch: copied before anything else evaluates.
  const control = Float32Array.from(ev.control);
  const garmentRest = ev.garments.map((g) => ({
    positions: Float32Array.from(g.positions),
    normals: Float32Array.from(g.normals),
  }));
  const kinds = new Set(options.attachments ?? []);
  const attachmentRest = ev.attachments.map((a) => ({
    positions: Float32Array.from(a.positions),
    normals: Float32Array.from(a.normals),
  }));
  const facialHairRest = ev.facialHair.map((hair) => ({
    positions: Float32Array.from(hair.positions),
    normals: Float32Array.from(hair.normals),
  }));
  const masks = ev.outfit.masks;
  if (!masks) throw new Error("an evaluation without its outfit's masks");
  const outfit = model.outfit(ev.outfit.order);
  const bones = restBones(model.assets, control);
  const names = bones.names;
  let body: FigurePartRest;
  let folds: readonly JointFold[] = [];
  let bodyName: string;
  if (bodyChoice === "surface") {
    const topology = ev.surface === "adult" ? model.adultSurface() : model.topology().body;
    if (!topology) throw new Error("an adult evaluation without the adult surface");
    const { skinIndex, skinWeight } = skinOfEvaluation(ev, topology);
    folds = solvedFolds(model, recipe).map(renderFold);
    bodyName = ev.surface;
    body = {
      id: "body",
      kind: "body",
      role: "body",
      rest: Float32Array.from(ev.positions),
      restNormals: Float32Array.from(ev.normals),
      index: masks.bodyIndex,
      uvs: topology.uvs,
      skinIndex,
      skinWeight,
      bodyRegion: regionsOf(skinIndex, skinWeight, names),
      material: null,
      textureUrl: null,
    };
  } else {
    const t = proxyTopology(model.assets, bodyChoice);
    const rest = fitProxy(model.assets, bodyChoice, control);
    bodyName = bodyChoice;
    body = {
      id: "body",
      kind: "body",
      role: "body",
      rest,
      // Normals over every triangle, so a hidden neighbour still shapes a shown edge.
      restNormals: triangleNormals(rest, t.index),
      index: proxyIndex(model.assets, bodyChoice, outfit.order.length ? outfit.bodyVisible : null),
      uvs: null,
      skinIndex: t.skinIndex,
      skinWeight: t.skinWeight,
      bodyRegion: regionsOf(t.skinIndex, t.skinWeight, names),
      material: null,
      textureUrl: null,
    };
  }
  const garments = ev.outfit.order.map((id, i): FigurePartRest => {
    const t = model.garmentTopology(id);
    const rest = garmentRest[i];
    if (!rest) throw new Error(`the evaluation has no garment ${id}`);
    return {
      id,
      kind: t.kind,
      role: "garment",
      rest: rest.positions,
      restNormals: rest.normals,
      index: masks.garmentIndex[i] as Uint32Array,
      uvs: t.uvs,
      skinIndex: t.skinIndex,
      skinWeight: t.skinWeight,
      bodyRegion: regionsOf(t.skinIndex, t.skinWeight, names),
      material: t.material,
      textureUrl: t.textureUrl,
    };
  });
  const attachments = model.topology().attachments.flatMap((t, i): FigurePartRest[] => {
    const rest = attachmentRest[i];
    if (!kinds.has(t.kind) || !rest) return [];
    return [
      {
        id: t.id,
        kind: t.kind,
        role: "attachment",
        rest: rest.positions,
        restNormals: rest.normals,
        index: t.index,
        uvs: t.uvs,
        skinIndex: t.skinIndex,
        skinWeight: t.skinWeight,
        bodyRegion: regionsOf(t.skinIndex, t.skinWeight, names),
        material: t.material,
        textureUrl: t.textureUrl,
      },
    ];
  });
  const facialHair = options.facialHair
    ? ev.facialHair.map((hair, i): FigurePartRest => {
        const t = model.hairTopology(hair.id);
        const rest = facialHairRest[i];
        if (!rest) throw new Error(`the evaluation has no facial hair ${hair.id}`);
        return {
          id: hair.id,
          kind: t.kind,
          role: "facialHair",
          rest: rest.positions,
          restNormals: rest.normals,
          index: t.index,
          uvs: t.uvs,
          skinIndex: t.skinIndex,
          skinWeight: t.skinWeight,
          bodyRegion: regionsOf(t.skinIndex, t.skinWeight, names),
          material: t.material,
          textureUrl: t.textureUrl,
        };
      })
    : [];
  return {
    parts: [body, ...garments, ...attachments, ...facialHair],
    body: bodyName,
    bones,
    control,
    folds,
    model,
  };
}

/** `rest` posed by `rotations`: every part skinned, then lifted with the figure onto the ground. */
export function poseFigure(rest: FigureRest, rotations: BoneRotations): PosedFigure {
  const posed = rest.parts.map((p, i) => {
    const folds = i === 0 ? rest.folds : undefined;
    const n = p.rest.length;
    return {
      ...p,
      positions: skinPositions(
        rest.bones,
        rotations,
        p.rest,
        p.skinIndex,
        p.skinWeight,
        new Float32Array(n),
        folds,
      ),
      normals: skinNormals(
        rest.bones,
        rotations,
        p.restNormals,
        p.skinIndex,
        p.skinWeight,
        new Float32Array(n),
        folds,
      ),
    };
  });
  const worn = rest.parts
    .slice(1)
    .map((p) => ({ positions: p.rest, skinIndex: p.skinIndex, skinWeight: p.skinWeight }));
  const lift = posedGroundOffset(rest.bones, rotations, rest.control, rest.model.rigSkin(), worn);
  for (const p of posed)
    for (let k = 1; k < p.positions.length; k += 3)
      p.positions[k] = (p.positions[k] as number) + lift;
  return { parts: posed, body: rest.body, bones: rest.bones, rotations, groundOffset: lift };
}

/** The dressed figure of `recipe` posed by `rotations` (`figureAtRest`, then `poseFigure`). */
export function posedFigure(
  model: HumanoidModel,
  recipe: Recipe,
  rotations: BoneRotations,
  options: FigureOptions = {},
): PosedFigure {
  return poseFigure(figureAtRest(model, recipe, options), rotations);
}
