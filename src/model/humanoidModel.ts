/**
 * The evaluation pipeline for one loaded body pack:
 * recipe → regional macro + modifier contributions → morphed control mesh →
 * subdivided body surface, plus every bound attachment (eyes, teeth, tongue,
 * and later hair and clothing) placed on that same morphed mesh.
 * Framework-free; runs in a worker or on the main thread.
 */
import { meanCurvature, triangleEdges } from "../build/curvature.ts";
import { buildSurfaceMesh, evaluateSurface, type SurfaceMesh } from "../build/surfaceMesh.ts";
import {
  type AttachmentMaterial,
  type BoundAsset,
  groupFaces,
  type HairStyleEntry,
  type HumanoidAssets,
  pendingTargetFiles,
} from "../format/assetFormat.ts";
import { NO_FEATURE } from "../makehuman/features.ts";
import { RecipeError, recipeContributions } from "../makehuman/recipeMorph.ts";
import { buildRegionField } from "../makehuman/regions.ts";
import { STATE_MORPHS, type StateMorph, stateContributions } from "../makehuman/stateMorphs.ts";
import { bindingSkin, evaluateBinding } from "../mhclo/bound.ts";
import { evaluateMorph, MorphError, type RegionField } from "../morph/evaluate.ts";
import { assertSignalPolicy } from "../recipe/agePolicy.ts";
import { createRecipe, type Recipe } from "../recipe/recipe.ts";
import { OCCLUSION_KEYS, occlusionCorners, occlusionCornerUnits } from "../rig/occlusionKeys.ts";
import { faceUnitRotations, type RigSkin, restBones, rigData, skinPositions } from "../rig/pose.ts";
import { applyStencil, type Stencil } from "../subdiv/catmullClark.ts";
import { GROWTH_SCALE, type HairFields, hairFields } from "../surface/hairFields.ts";
import {
  buildLayerFields,
  isAdultLayer,
  type LayerFieldsUpdate,
  uvScale,
} from "../surface/layers.ts";
import { bakeOcclusion, type OcclusionBaseline } from "../surface/occlusion.ts";
import { SKIN_LAYERS } from "../surface/regions/index.ts";

export interface ModelOptions {
  /** Catmull–Clark levels for the body surface (0–2). Default 1. Attachments use at most 1. */
  subdivision?: number;
  /** Attachment ids to wear; defaults to every attachment in the body pack (eyes, teeth, tongue). */
  attachments?: readonly string[];
}

/** Static render data: sent once, reused for every evaluation. */
export interface SurfaceTopology {
  index: Uint32Array;
  uvs: Float32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  vertexCount: number;
}

export interface AttachmentTopology extends SurfaceTopology {
  id: string;
  kind: string;
  /** Render order hint from the asset (MakeHuman `z_depth`): higher draws later. */
  zDepth: number;
  material: AttachmentMaterial;
  /** Resolved URL of the diffuse texture, or null when untextured or loaded without URLs. */
  textureUrl: string | null;
  /**
   * Per render vertex, how open it is to light (1) or enclosed by the figure
   * (0), baked against the default figure (lids over eyes, lips over teeth) at
   * each corner of the `OCCLUSION_KEYS` cube: `occlusionCorners(keys)` values
   * per vertex, the first at rest. A pose's occlusion is their multilinear
   * blend (`occlusionCornerWeights` of `occlusionKeyWeights`).
   */
  occlusion: Float32Array;
}

/**
 * Static render data of a hair style: sent once per style, when a figure first
 * wears it. A hair style is an alpha-card attachment (`AttachmentTopology`'s
 * mesh and material) with one occlusion value per vertex, since hair is lit
 * from outside and the pose never opens it up as it does a mouth.
 */
export interface HairTopology extends SurfaceTopology {
  id: string;
  label: string;
  tags: string[];
  /** Render order hint from the asset (MakeHuman `z_depth`). */
  zDepth: number;
  material: AttachmentMaterial;
  /** Resolved URL of the strand map, or null when loaded without URLs. */
  textureUrl: string | null;
  /** Per render vertex, how open it is to light (1) or buried in the hair or against the scalp (0), at rest. */
  occlusion: Float32Array;
  /** Per render vertex, 0 where the hair is dithered away (a hairline against the scalp) to 1 where it is all there. */
  fade: Float32Array;
  /** Per render vertex, 1 on a card standing out of the scalp (dithered away when seen edge-on), 0 on one lying along it. */
  fin: Float32Array;
  /**
   * Per render vertex, metres along its card from where the hair roots. Its
   * gradient across the screen is the strand's direction (the highlight's tangent).
   */
  growth: Float32Array;
  /**
   * Per body render vertex (`ModelTopology.body`'s), how densely this style
   * grows from the skin there: 1 under it, falling to 0 beyond its edge.
   * The skin is tinted by the hair's colour in proportion (stubble).
   */
  scalp: Float32Array;
  /** Which way strands run in the strand map, and how consistently (`HairStyleEntry.strand`). */
  strand: { angle: number; coherence: number };
}

export interface ModelTopology {
  body: SurfaceTopology & {
    /**
     * The skin layers' fields per render vertex (`SKIN_LAYERS` order): for each
     * layer in turn, `vertexCount` pairs of (mask, coordinate).
     */
    layerFields: Float32Array;
    /** Ids of the layers `layerFields` holds, in order. */
    layers: string[];
    /** Per render vertex, metres of skin per UV unit (`uvScale`), for relief at true size. */
    uvScale: Float32Array;
  };
  attachments: AttachmentTopology[];
}

/** Per render vertex, an index into a `FeatureMap`'s features (or `NO_FEATURE`). */
export interface RenderFeatures {
  body: Uint8Array;
  /** In `ModelTopology.attachments` order. */
  attachments: Uint8Array[];
}

export interface SurfaceEvaluation {
  positions: Float32Array;
  normals: Float32Array;
}

/** The input a surface vertex follows most: the largest weight in its stencil row. */
function dominantInput(stencil: Stencil, surfaceVertex: number): number {
  let best = -1;
  let weight = Number.NEGATIVE_INFINITY;
  for (
    let k = stencil.offsets[surfaceVertex] as number;
    k < (stencil.offsets[surfaceVertex + 1] as number);
    k++
  ) {
    if ((stencil.weights[k] as number) > weight) {
      weight = stencil.weights[k] as number;
      best = stencil.src[k] as number;
    }
  }
  return best;
}

/** The worn hair style's evaluated surface; its static data is `HairTopology`, by `id`. */
export interface HairEvaluation extends SurfaceEvaluation {
  id: string;
}

export interface Evaluation extends SurfaceEvaluation {
  /** One entry per attachment, in `ModelTopology.attachments` order. */
  attachments: SurfaceEvaluation[];
  /** The recipe's hair, or null when it has none. */
  hair: HairEvaluation | null;
  /** Lift (metres) that puts the lowest body point on y = 0. */
  groundOffset: number;
  /** Morphed control positions (base topology), for joints, bindings and measurement. */
  control: Float32Array;
  /** Per body render vertex: mean curvature magnitude (m⁻¹), for subsurface scattering. */
  curvature: Float32Array;
  /** The skeleton fitted to this figure: each bone's rest head (`restBones`), bones × 3. */
  boneHeads: Float32Array;
}

interface Part {
  mesh: SurfaceMesh;
  scratch: { surface: Float32Array; normals: Float32Array };
}

const part = (mesh: SurfaceMesh): Part => {
  const n = mesh.topology.vertexCount * 3;
  return { mesh, scratch: { surface: new Float32Array(n), normals: new Float32Array(n) } };
};

/** Area-weighted vertex normals of a quad mesh (each quad split along one diagonal). */
function quadVertexNormals(positions: Float32Array, faceVerts: Uint32Array): Float32Array {
  const out = new Float32Array(positions.length);
  const p = (i: number, k: number) => positions[i * 3 + k] as number;
  for (let f = 0; f < faceVerts.length; f += 4) {
    const q = [0, 1, 2, 3].map((k) => faceVerts[f + k] as number) as [
      number,
      number,
      number,
      number,
    ];
    // Cross product of the diagonals: twice the quad's vector area.
    const d1 = [0, 1, 2].map((k) => p(q[2], k) - p(q[0], k));
    const d2 = [0, 1, 2].map((k) => p(q[3], k) - p(q[1], k));
    const nx = (d1[1] as number) * (d2[2] as number) - (d1[2] as number) * (d2[1] as number);
    const ny = (d1[2] as number) * (d2[0] as number) - (d1[0] as number) * (d2[2] as number);
    const nz = (d1[0] as number) * (d2[1] as number) - (d1[1] as number) * (d2[0] as number);
    for (const v of q) {
      out[v * 3] = (out[v * 3] as number) + nx;
      out[v * 3 + 1] = (out[v * 3 + 1] as number) + ny;
      out[v * 3 + 2] = (out[v * 3 + 2] as number) + nz;
    }
  }
  return out;
}

const topologyOf = (m: SurfaceMesh): SurfaceTopology => ({
  index: m.index,
  uvs: m.uvs,
  skinIndex: m.skinIndex,
  skinWeight: m.skinWeight,
  vertexCount: m.renderToSurface.length,
});

/** The figure attachment occlusion is baked against (and the pack's bake was): the default one. */
const occlusionFigure = (): Recipe => createRecipe();

/** Share of a body vertex's skin weight the head bone must hold for it to take a scalp tint. */
const HEAD_WEIGHT = 0.5;

export class HumanoidModel {
  readonly regions: RegionField;
  private readonly body: Part;
  private readonly bodyVertices: Uint32Array;
  private readonly bodyControlTriangles: Uint32Array;
  private readonly bodyEdges: Uint32Array;
  private readonly attached: { asset: BoundAsset; part: Part; control: Float32Array }[];
  /** Hair styles worn so far, built on first use. */
  private readonly hairParts = new Map<
    string,
    { asset: BoundAsset; part: Part; control: Float32Array }
  >();
  /** Subdivision level of the attachments: the body's, at most 1. */
  private readonly attachmentLevel: number;
  private readonly layerFields: Float32Array;
  private readonly uvScale: Float32Array;
  /** The body's state morphs and, with the adult pack, its own (`AdultAnatomySpec.stateMorphs`). */
  private readonly stateMorphs: readonly StateMorph[];
  /** The rest bake of the worn set, kept for the corner bakes to reuse. */
  private restOcclusion: {
    rest: Float32Array;
    surfaces: readonly Part[];
    bake: OcclusionBaseline;
  } | null = null;

  readonly assets: HumanoidAssets;

  constructor(assets: HumanoidAssets, options: ModelOptions = {}) {
    this.assets = assets;
    const level = options.subdivision ?? 1;
    if (!Number.isInteger(level) || level < 0 || level > 2) {
      throw new RangeError(`subdivision must be 0, 1 or 2; got ${level}`);
    }
    this.regions = buildRegionField(assets);
    this.stateMorphs = [
      ...STATE_MORPHS,
      ...(assets.adultAnatomyManifest?.anatomy?.stateMorphs ?? []),
    ];
    const ids = options.attachments ?? [...assets.attachments.keys()];
    const wearing = ids.map((id) => {
      const a = assets.attachments.get(id);
      if (!a) throw new Error(`unknown attachment ${id}`);
      return a;
    });

    // Body faces a worn attachment covers (its MHCLO delete_verts) are left out.
    // As in MakeHuman, a face goes only when all its corners are deleted: one
    // that keeps a visible corner stays, so no gap opens at a garment's edge.
    const hidden = new Set<number>();
    for (const a of wearing) for (const v of a.deleteVerts) hidden.add(v);
    const bodyFaces = groupFaces(assets, "body").filter((f) => {
      for (let k = 0; k < 4; k++)
        if (!hidden.has(assets.faceVerts[f * 4 + k] as number)) return true;
      return false;
    });
    this.body = part(
      buildSurfaceMesh({ ...assets, vertexCount: assets.manifest.vertexCount }, bodyFaces, level),
    );
    const verts = new Set<number>();
    for (const f of bodyFaces)
      for (let k = 0; k < 4; k++) verts.add(assets.faceVerts[f * 4 + k] as number);
    this.bodyVertices = Uint32Array.from(verts);
    // The unsubdivided body as triangles: a cheap occluder for baking attachment occlusion.
    this.bodyControlTriangles = new Uint32Array(bodyFaces.length * 6);
    bodyFaces.forEach((f, i) => {
      const q = [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number);
      this.bodyControlTriangles.set([q[0], q[1], q[2], q[0], q[2], q[3]] as number[], i * 6);
    });
    // Layer fields are static: carry the base-vertex fields through the subdivision stencil once.
    this.bodyEdges = triangleEdges(this.body.mesh.index);
    const n = assets.manifest.vertexCount;
    // The adult layers' fields stay zero here whatever has loaded: the adult
    // anatomy's data never rides in the static topology, only in the update
    // `adultLayerFields` makes once its targets have arrived.
    this.layerFields = this.renderLayerFields(
      buildLayerFields(assets, SKIN_LAYERS, (l) => !isAdultLayer(l)),
      SKIN_LAYERS.length,
    );
    const r2s = this.body.mesh.renderToSurface;
    const surface = new Float32Array(this.body.mesh.topology.vertexCount * 3);
    // Metres per UV unit, for relief at true size; carried the same way.
    const scale = uvScale(assets, bodyFaces);
    const scaleField = new Float32Array(n * 3);
    scale.forEach((s, v) => {
      scaleField[v * 3] = s;
    });
    applyStencil(this.body.mesh.stencil, scaleField, surface);
    this.uvScale = Float32Array.from(r2s, (s) => surface[s * 3] as number);

    this.attachmentLevel = Math.min(level, 1);
    this.attached = wearing.map((asset) => ({
      asset,
      part: part(this.attachmentSurface(asset, this.attachmentLevel)),
      control: new Float32Array(asset.entry.vertexCount * 3),
    }));
  }

  /**
   * Base-vertex layer fields (`buildLayerFields`' layout) carried to the body's
   * render vertices through the subdivision stencil: for each of `count`
   * layers, `renderVertexCount` pairs of (mask, coordinate).
   */
  private renderLayerFields(fields: Float32Array, count: number): Float32Array {
    const n = this.assets.manifest.vertexCount;
    const r2s = this.body.mesh.renderToSurface;
    const surface = new Float32Array(this.body.mesh.topology.vertexCount * 3);
    const out = new Float32Array(count * r2s.length * 2);
    for (let l = 0; l < count; l++) {
      applyStencil(this.body.mesh.stencil, fields.subarray(l * n * 3, (l + 1) * n * 3), surface);
      const base = l * r2s.length * 2;
      r2s.forEach((s, r) => {
        out[base + r * 2] = surface[s * 3] as number;
        out[base + r * 2 + 1] = surface[s * 3 + 1] as number;
      });
    }
    return out;
  }

  /**
   * The adult anatomy's layers' fields per render vertex, or null while the
   * adult pack's targets they are measured from have not loaded (or no adult
   * pack is). The topology carries these layers as zero; the worker posts this
   * once the adult stage arrives, and the renderer re-rasterises only their
   * pages of the field atlas, with no shader recompile and no re-evaluation.
   */
  adultLayerFields(): LayerFieldsUpdate | null {
    const adult = SKIN_LAYERS.filter(isAdultLayer);
    if (!adult.every((l) => l.available?.(this.assets))) return null;
    return {
      layers: adult.map((l) => l.id),
      layerFields: this.renderLayerFields(buildLayerFields(this.assets, adult), adult.length),
    };
  }

  private attachmentSurface(asset: BoundAsset, level: number): SurfaceMesh {
    const skin = bindingSkin(asset, this.assets.skinIndex, this.assets.skinWeight);
    return buildSurfaceMesh(
      {
        vertexCount: asset.entry.vertexCount,
        faceVerts: asset.faceVerts,
        faceUvs: asset.faceUvs,
        uvs: asset.uvs,
        skinIndex: skin.index,
        skinWeight: skin.weight,
      },
      null,
      level,
    );
  }

  /**
   * Bakes each worn attachment's occlusion per control vertex: geometry the
   * figure creates around its attachments, against the default figure, where
   * lids and lips sit as on most figures, at every corner of the
   * `OCCLUSION_KEYS` cube (the body posed by `skinPositions`, the attachments
   * bound to it; corner 0 is rest). Rays start from the control vertices (a
   * quarter of the render vertices); occluders are the unsubdivided body and
   * the opaque attachments at one subdivision level, whatever this model's
   * level, so the result depends only on the packs and the worn set. Per
   * attachment, one bake per corner, each `vertexCount` long.
   */
  bakeAttachmentOcclusion(): Float32Array[] {
    const steps = this.bakeOcclusionCorners();
    for (;;) {
      const step = steps.next();
      if (step.done) return step.value;
    }
  }

  /**
   * `bakeAttachmentOcclusion` a corner at a time: it yields before each
   * corner after rest, so a caller can let other work in between.
   */
  private *bakeOcclusionCorners(): Generator<void, Float32Array[]> {
    const { rest, surfaces, bake: atRest } = this.occlusionAtRest();
    const bones = restBones(this.assets, rest);
    const rig = rigData(this.assets);
    const bakes = [atRest.values];
    for (let m = 1; m < occlusionCorners(OCCLUSION_KEYS.length); m++) {
      yield;
      const body = skinPositions(
        bones,
        faceUnitRotations(rig, occlusionCornerUnits(m)),
        rest,
        this.assets.skinIndex,
        this.assets.skinWeight,
        new Float32Array(rest.length),
      );
      // Every corner reuses the rest bake wherever nothing within reach moved.
      bakes.push(this.bakeOcclusionAt(body, surfaces, atRest).values);
    }
    return this.attached.map((a, i) => {
      const n = a.asset.entry.vertexCount;
      const out = new Float32Array(n * bakes.length);
      bakes.forEach((b, k) => {
        out.set(b[i] as Float32Array, k * n);
      });
      return out;
    });
  }

  /** The worn set's bake at rest, made once and kept for the corners. */
  private occlusionAtRest(): NonNullable<HumanoidModel["restOcclusion"]> {
    if (!this.restOcclusion) {
      const rest = this.evaluate(occlusionFigure()).control;
      // Occluding attachments at one subdivision level, whatever this model's.
      const surfaces = this.attached.map((a) =>
        this.attachmentLevel === 1 ? a.part : part(this.attachmentSurface(a.asset, 1)),
      );
      this.restOcclusion = {
        rest,
        surfaces,
        bake: this.bakeOcclusionAt(rest, surfaces, undefined),
      };
    }
    return this.restOcclusion;
  }

  /**
   * The pose-following occlusion of a worn set the pack did not bake, per
   * render vertex as in `AttachmentTopology.occlusion`, or null when
   * `topology()` already carries it. `topology()` bakes such a set at rest
   * only (every corner holding the rest value), since the corners take
   * seconds; this bakes them, yielding before each so a worker can answer
   * evaluations in between. Needs the target files `occlusionBakeRecipe()`
   * names.
   */
  *bakePosedOcclusion(): Generator<void, Float32Array[] | null> {
    if (this.wearsPackedSet()) return null;
    return this.renderOcclusion(yield* this.bakeOcclusionCorners());
  }

  /**
   * One occlusion bake of the worn attachments, bound to body control
   * positions `body`; with `baseline`, vertices nothing near has moved for
   * keep its values (`OcclusionOptions.baseline`).
   */
  private bakeOcclusionAt(
    body: Float32Array,
    surfaces: readonly Part[],
    baseline: OcclusionBaseline | undefined,
  ): OcclusionBaseline {
    const controls = this.attached.map((a) =>
      evaluateBinding(a.asset, body, new Float32Array(a.control.length)),
    );
    const occluders = [
      { positions: body, index: this.bodyControlTriangles },
      ...this.attached.flatMap((a, i) => {
        // Transparent attachments (the eyes, whose cornea dome is cut away by the
        // texture's alpha) would block light they do not block when rendered.
        if (a.asset.entry.material.transparent) return [];
        const p = surfaces[i] as Part;
        return [
          {
            positions: this.evaluatePart(p, controls[i] as Float32Array).positions,
            index: p.mesh.index,
          },
        ];
      }),
    ];
    const targets = this.attached.map((a, i) => ({
      positions: controls[i] as Float32Array,
      normals: quadVertexNormals(controls[i] as Float32Array, a.asset.faceVerts),
    }));
    const values = bakeOcclusion(occluders, targets, {
      rays: 32,
      ...(baseline && { baseline }),
    });
    return { occluders, targets, values };
  }

  /**
   * Bakes a hair style's occlusion per control vertex, at rest, against the
   * default figure: how open each card vertex is to light. Hair is lit from
   * outside, so a card under others, or against the scalp and neck, is darker
   * than one on the outside of the volume. Cards are two-sided and their
   * normals say nothing about which side faces out, so each vertex takes the
   * more open of its two sides, and the rays meet the body and the style's own
   * cards (as solid triangles: the cards' cut-outs are not modelled, which
   * darkens the interior of sparse styles somewhat, and the floor in
   * `OCCLUSION_FLOOR` keeps it from going black). The result depends only on
   * the packs, so the packer bakes it once. Needs the default figure's target
   * files.
   */
  bakeHairOcclusion(asset: BoundAsset): Float32Array {
    const rest = this.evaluate(occlusionFigure()).control;
    const control = evaluateBinding(asset, rest, new Float32Array(asset.entry.vertexCount * 3));
    const normals = quadVertexNormals(control, asset.faceVerts);
    const cards = new Uint32Array(asset.entry.faceCount * 6);
    for (let f = 0; f < asset.entry.faceCount; f++) {
      const q = [0, 1, 2, 3].map((k) => asset.faceVerts[f * 4 + k] as number);
      cards.set([q[0], q[1], q[2], q[0], q[2], q[3]] as number[], f * 6);
    }
    const occluders = [
      { positions: rest, index: this.bodyControlTriangles },
      { positions: control, index: cards },
    ];
    const outward = bakeOcclusion(occluders, [{ positions: control, normals }], { rays: 32 })[0];
    const inward = bakeOcclusion(
      occluders,
      [{ positions: control, normals: normals.map((x) => -x) }],
      { rays: 32 },
    )[0];
    return Float32Array.from(outward as Float32Array, (o, v) =>
      Math.max(o, (inward as Float32Array)[v] as number),
    );
  }

  /**
   * Measures a hair style's growth, hairline fade and scalp against the default
   * figure at rest (`hairFields`). The scalp may carry hair only on the head:
   * a body vertex the head bone moves most (the neck, shoulders and jaw's
   * beard line are never tinted). Depends only on the packs, so the packer
   * bakes it once. Needs the default figure's target files.
   */
  bakeHairFields(asset: BoundAsset): HairFields {
    const rest = this.evaluate(occlusionFigure()).control;
    const control = evaluateBinding(asset, rest, new Float32Array(asset.entry.vertexCount * 3));
    const head = this.assets.manifest.skeleton.bones.findIndex((b) => b.name === "head");
    if (head < 0) throw new MorphError("the body pack's skeleton has no head bone");
    const { skinIndex, skinWeight } = this.assets;
    const eligible = new Uint8Array(this.assets.manifest.vertexCount);
    for (let v = 0; v < eligible.length; v++) {
      let onHead = 0;
      for (let k = 0; k < 4; k++)
        if (skinIndex[v * 4 + k] === head) onHead += skinWeight[v * 4 + k] as number;
      eligible[v] = onHead >= HEAD_WEIGHT ? 1 : 0;
    }
    const cards = asset.faceVerts;
    return hairFields({
      positions: control,
      faceVerts: cards,
      body: { positions: rest, triangles: this.bodyControlTriangles },
      scalpEligible: eligible,
    });
  }

  /**
   * Carries a per-base-vertex feature map (`buildFeatureMap`) to the render
   * vertices: a body vertex takes the feature of the base vertex its
   * subdivision stencil weights most, an attachment vertex the feature of the
   * first base vertex its dominant control vertex is bound to.
   */
  renderFeatures(vertexFeature: Uint8Array): RenderFeatures {
    const of = (base: number) => vertexFeature[base] ?? NO_FEATURE;
    const { stencil, renderToSurface } = this.body.mesh;
    return {
      body: Uint8Array.from(renderToSurface, (s) => of(dominantInput(stencil, s))),
      attachments: this.attached.map(({ asset, part: p }) =>
        Uint8Array.from(p.mesh.renderToSurface, (s) =>
          of(asset.refVerts[dominantInput(p.mesh.stencil, s) * 3] as number),
        ),
      ),
    };
  }

  /**
   * The body pack ships the bake for its own attachments worn together, so
   * loading casts no rays; any other set is baked by `topology()`.
   */
  private wearsPackedSet(): boolean {
    const worn = new Set(this.attached.map((a) => a.asset.entry.id));
    const keys = this.assets.manifest.attachments.occlusionKeys;
    return (
      worn.size === this.attached.length &&
      worn.size === this.assets.attachments.size &&
      // A pack baked at other keys than this code's is re-baked, not misread.
      keys.length === OCCLUSION_KEYS.length &&
      keys.every((k, i) => k === OCCLUSION_KEYS[i]?.id)
    );
  }

  /**
   * The hair style a recipe wears that has not arrived yet (`HairAssets.load`
   * brings it), or null when it has none or has what it needs. An unknown
   * style id is an error, as an unknown modifier is.
   */
  pendingHair(recipe: Recipe): string | null {
    const id = recipe.hair?.style ?? null;
    if (id === null) return null;
    return this.hairEntry(id) && this.assets.hair?.bound.has(id) ? null : id;
  }

  /** The manifest entry of a style the loaded hair pack must have. */
  private hairEntry(id: string): HairStyleEntry {
    const entry = this.assets.hair?.styles.get(id);
    if (!entry)
      throw new RecipeError(
        this.assets.hair
          ? `unknown hair style ${id}`
          : `the recipe wears hair style ${id}, but no hair pack is loaded`,
      );
    return entry;
  }

  /** A hair style's mesh, built the first time it is worn. Its geometry must have arrived. */
  private hairPart(id: string): { asset: BoundAsset; part: Part; control: Float32Array } {
    let h = this.hairParts.get(id);
    if (!h) {
      this.hairEntry(id);
      const asset = this.assets.hair?.bound.get(id);
      if (!asset)
        throw new MorphError(
          `hair style ${id} has not loaded yet (await assets.hair.load(${JSON.stringify(id)}))`,
        );
      h = {
        asset,
        part: part(this.attachmentSurface(asset, this.attachmentLevel)),
        control: new Float32Array(asset.entry.vertexCount * 3),
      };
      this.hairParts.set(id, h);
    }
    return h;
  }

  /** A hair style's static render data, carried to the render vertices. Needs its geometry loaded. */
  hairTopology(id: string): HairTopology {
    const { asset, part: p } = this.hairPart(id);
    const entry = this.hairEntry(id);
    // The per-control-vertex bake, one value at a time through the stencil like any field.
    const n = asset.entry.vertexCount;
    const r2s = p.mesh.renderToSurface;
    const surface = new Float32Array(p.mesh.topology.vertexCount * 3);
    /** A per-control-vertex scalar, carried to the render vertices through the style's stencil. */
    const carry = (value: (v: number) => number): Float32Array => {
      const field = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) field[v * 3] = value(v);
      applyStencil(p.mesh.stencil, field, surface);
      return Float32Array.from(r2s, (s) => surface[s * 3] as number);
    };
    const fields = asset.hair;
    if (!fields) throw new MorphError(`hair style ${id} carries no measured fields`);
    // The scalp lives on the body: its base vertices' density through the body's stencil.
    const bodyBase = this.assets.manifest.vertexCount;
    const scalpField = new Float32Array(bodyBase * 3);
    fields.scalpVerts.forEach((v, i) => {
      scalpField[v * 3] = (fields.scalpWeights[i] as number) / 255;
    });
    const bodySurface = new Float32Array(this.body.mesh.topology.vertexCount * 3);
    applyStencil(this.body.mesh.stencil, scalpField, bodySurface);
    const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
    return {
      ...topologyOf(p.mesh),
      id,
      label: entry.label,
      tags: entry.tags,
      zDepth: asset.entry.zDepth,
      material: asset.entry.material,
      textureUrl: asset.entry.material.texture
        ? (this.assets.fileUrls.get(asset.entry.material.texture) ?? null)
        : null,
      occlusion: carry((v) => (asset.occlusion[v] as number) / 255).map(clamp01),
      fade: carry((v) => (fields.fade[v] as number) / 255).map(clamp01),
      fin: carry((v) => (fields.fin[v] as number) / 255).map(clamp01),
      growth: carry((v) => (fields.growth[v] as number) / GROWTH_SCALE),
      scalp: Float32Array.from(this.body.mesh.renderToSurface, (s) =>
        clamp01(bodySurface[s * 3] as number),
      ),
      strand: entry.strand,
    };
  }

  /** Each bone's parent index in skin-weight order (-1 for the root). */
  boneParents(): Int16Array {
    return restBones(this.assets, this.assets.positions).parents;
  }

  /** The pack's skin and the visible body's base vertices, for grounding a posed figure. */
  rigSkin(): RigSkin {
    return {
      skinIndex: this.assets.skinIndex,
      skinWeight: this.assets.skinWeight,
      bodyVertices: this.bodyVertices,
    };
  }

  /**
   * The recipe `topology()` evaluates to bake attachment occlusion, or null
   * when the pack's bake applies. A staged load awaits its target files before
   * calling `topology()` (the default figure is an adult, so a child or very
   * old first figure does not bring them in its first stage).
   */
  occlusionBakeRecipe(): Recipe | null {
    return this.wearsPackedSet() ? null : occlusionFigure();
  }

  topology(): ModelTopology {
    const corners = occlusionCorners(OCCLUSION_KEYS.length);
    const baked = this.wearsPackedSet()
      ? this.attached.map(({ asset }) => Float32Array.from(asset.occlusion, (o) => o / 255))
      : // Rest at every corner until `bakePosedOcclusion` brings the others.
        this.occlusionAtRest().bake.values.map((rest) => {
          const out = new Float32Array(rest.length * corners);
          for (let m = 0; m < corners; m++) out.set(rest, m * rest.length);
          return out;
        });
    const occlusion = this.renderOcclusion(baked);
    return {
      body: {
        ...topologyOf(this.body.mesh),
        layerFields: this.layerFields,
        layers: SKIN_LAYERS.map((l) => l.id),
        uvScale: this.uvScale,
      },
      attachments: this.attached.map(({ asset, part: p }, i) => ({
        occlusion: occlusion[i] as Float32Array,
        ...topologyOf(p.mesh),
        id: asset.entry.id,
        kind: asset.entry.kind,
        zDepth: asset.entry.zDepth,
        material: asset.entry.material,
        textureUrl: asset.entry.material.texture
          ? (this.assets.fileUrls.get(asset.entry.material.texture) ?? null)
          : null,
      })),
    };
  }

  /**
   * Per-control-vertex corner bakes (`bakeAttachmentOcclusion`'s layout)
   * carried to the render vertices by the subdivision stencil, like any other
   * per-vertex field, three corners at a time (the stencil's stride).
   */
  private renderOcclusion(baked: readonly Float32Array[]): Float32Array[] {
    const corners = occlusionCorners(OCCLUSION_KEYS.length);
    return this.attached.map(({ asset, part: p }, i) => {
      const n = asset.entry.vertexCount;
      const all = baked[i] as Float32Array;
      const r2s = p.mesh.renderToSurface;
      const out = new Float32Array(r2s.length * corners);
      const field = new Float32Array(n * 3);
      const surface = new Float32Array(p.mesh.topology.vertexCount * 3);
      for (let first = 0; first < corners; first += 3) {
        const count = Math.min(3, corners - first);
        field.fill(0);
        for (let v = 0; v < n; v++)
          for (let c = 0; c < count; c++) field[v * 3 + c] = all[(first + c) * n + v] as number;
        applyStencil(p.mesh.stencil, field, surface);
        r2s.forEach((s, r) => {
          for (let c = 0; c < count; c++)
            out[r * corners + first + c] = surface[s * 3 + c] as number;
        });
      }
      return out;
    });
  }

  /**
   * The target files a recipe (in a skin state) needs that have not arrived
   * (empty when it can be evaluated now). Validates the recipe first.
   */
  pendingTargetFiles(recipe: Recipe, signals: Readonly<Record<string, number>> = {}): Set<string> {
    return this.pendingFor(this.contributions(recipe, signals));
  }

  /** The recipe's target weights, plus its skin state's (`STATE_MORPHS`), after the age policy. */
  private contributions(recipe: Recipe, signals: Readonly<Record<string, number>>) {
    const fromRecipe = recipeContributions(recipe, this.assets.modifiers);
    assertSignalPolicy(recipe, signals);
    // A state of the adult anatomy has nothing to drive without the adult pack.
    return [
      ...fromRecipe,
      ...stateContributions(signals, this.stateMorphs, (target) =>
        this.assets.targetFileOf.has(target),
      ),
    ];
  }

  private pendingFor(contributions: readonly { target: string }[]): Set<string> {
    const pending = pendingTargetFiles(
      this.assets,
      contributions.map((c) => c.target),
    );
    // A name in no loaded pack's files is not pending: evaluation reports it as unknown.
    pending.delete("");
    return pending;
  }

  /**
   * Evaluates a recipe in a skin state: `signals` (0..1 each, see
   * docs/ARCHITECTURE.md, "Skin states") add their state morphs. A state is
   * never part of the recipe; adult-only signals are refused under 18.
   */
  evaluate(recipe: Recipe, signals: Readonly<Record<string, number>> = {}): Evaluation {
    const contributions = this.contributions(recipe, signals);
    const pending = this.pendingFor(contributions);
    if (pending.size)
      throw new MorphError(
        `the recipe needs target files that have not loaded yet: ${[...pending].join(", ")} ` +
          "(await their stage of loadHumanoidAssetsStaged)",
      );
    // An unknown or unloaded style fails before any morphing is spent on it.
    const id = recipe.hair?.style ?? null;
    const worn = id === null ? null : { id, h: this.hairPart(id) };
    const control = new Float32Array(this.assets.positions.length);
    evaluateMorph(this.assets.positions, this.assets.targets, contributions, control, this.regions);
    let minY = Number.POSITIVE_INFINITY;
    for (const v of this.bodyVertices) minY = Math.min(minY, control[v * 3 + 1] as number);
    const body = this.evaluatePart(this.body, control);
    const attachments = this.attached.map((a) =>
      this.evaluatePart(a.part, evaluateBinding(a.asset, control, a.control)),
    );
    const hair =
      worn === null
        ? null
        : {
            id: worn.id,
            ...this.evaluatePart(
              worn.h.part,
              evaluateBinding(worn.h.asset, control, worn.h.control),
            ),
          };
    const curvature = meanCurvature(
      body.positions,
      body.normals,
      this.bodyEdges,
      new Float32Array(body.positions.length / 3),
    );
    const boneHeads = restBones(this.assets, control).heads;
    return { ...body, attachments, hair, groundOffset: -minY, control, curvature, boneHeads };
  }

  private evaluatePart(p: Part, control: Float32Array): SurfaceEvaluation {
    const n = p.mesh.renderToSurface.length * 3;
    const positions = new Float32Array(n);
    const normals = new Float32Array(n);
    evaluateSurface(p.mesh, control, positions, normals, p.scratch);
    return { positions, normals };
  }
}
