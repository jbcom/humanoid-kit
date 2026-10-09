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
  type HumanoidAssets,
  pendingTargetFiles,
} from "../format/assetFormat.ts";
import { NO_FEATURE } from "../makehuman/features.ts";
import { recipeContributions } from "../makehuman/recipeMorph.ts";
import { buildRegionField } from "../makehuman/regions.ts";
import { bindingSkin, evaluateBinding } from "../mhclo/bound.ts";
import { evaluateMorph, MorphError, type RegionField } from "../morph/evaluate.ts";
import { createRecipe, type Recipe } from "../recipe/recipe.ts";
import { OCCLUSION_KEYS, occlusionCorners, occlusionCornerUnits } from "../rig/occlusionKeys.ts";
import { faceUnitRotations, restBones, rigData, skinPositions } from "../rig/pose.ts";
import { applyStencil, type Stencil } from "../subdiv/catmullClark.ts";
import { buildLayerFields } from "../surface/layers.ts";
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

export interface ModelTopology {
  body: SurfaceTopology & {
    /**
     * The skin layers' fields per render vertex (`SKIN_LAYERS` order): for each
     * layer in turn, `vertexCount` pairs of (mask, coordinate).
     */
    layerFields: Float32Array;
    /** Ids of the layers `layerFields` holds, in order. */
    layers: string[];
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

export interface Evaluation extends SurfaceEvaluation {
  /** One entry per attachment, in `ModelTopology.attachments` order. */
  attachments: SurfaceEvaluation[];
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

export class HumanoidModel {
  readonly regions: RegionField;
  private readonly body: Part;
  private readonly bodyVertices: Uint32Array;
  private readonly bodyControlTriangles: Uint32Array;
  private readonly bodyEdges: Uint32Array;
  private readonly attached: { asset: BoundAsset; part: Part; control: Float32Array }[];
  /** Subdivision level of the attachments: the body's, at most 1. */
  private readonly attachmentLevel: number;
  private readonly layerFields: Float32Array;

  readonly assets: HumanoidAssets;

  constructor(assets: HumanoidAssets, options: ModelOptions = {}) {
    this.assets = assets;
    const level = options.subdivision ?? 1;
    if (!Number.isInteger(level) || level < 0 || level > 2) {
      throw new RangeError(`subdivision must be 0, 1 or 2; got ${level}`);
    }
    this.regions = buildRegionField(assets);
    const ids = options.attachments ?? [...assets.attachments.keys()];
    const wearing = ids.map((id) => {
      const a = assets.attachments.get(id);
      if (!a) throw new Error(`unknown attachment ${id}`);
      return a;
    });

    // Body faces hidden by any worn attachment (its MHCLO delete_verts) are left out.
    const hidden = new Set<number>();
    for (const a of wearing) for (const v of a.deleteVerts) hidden.add(v);
    const bodyFaces = groupFaces(assets, "body").filter((f) => {
      for (let k = 0; k < 4; k++)
        if (hidden.has(assets.faceVerts[f * 4 + k] as number)) return false;
      return true;
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
    const fields = buildLayerFields(assets, SKIN_LAYERS);
    const r2s = this.body.mesh.renderToSurface;
    const surface = new Float32Array(this.body.mesh.topology.vertexCount * 3);
    this.layerFields = new Float32Array(SKIN_LAYERS.length * r2s.length * 2);
    SKIN_LAYERS.forEach((_, l) => {
      applyStencil(this.body.mesh.stencil, fields.subarray(l * n * 3, (l + 1) * n * 3), surface);
      const base = l * r2s.length * 2;
      r2s.forEach((s, r) => {
        this.layerFields[base + r * 2] = surface[s * 3] as number;
        this.layerFields[base + r * 2 + 1] = surface[s * 3 + 1] as number;
      });
    });

    this.attachmentLevel = Math.min(level, 1);
    this.attached = wearing.map((asset) => ({
      asset,
      part: part(this.attachmentSurface(asset, this.attachmentLevel)),
      control: new Float32Array(asset.entry.vertexCount * 3),
    }));
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
    const rest = this.evaluate(occlusionFigure()).control;
    const bones = restBones(this.assets, rest);
    const rig = rigData(this.assets);
    const bodies = Array.from({ length: occlusionCorners(OCCLUSION_KEYS.length) }, (_, m) =>
      m === 0
        ? rest
        : skinPositions(
            bones,
            faceUnitRotations(rig, occlusionCornerUnits(m)),
            rest,
            this.assets.skinIndex,
            this.assets.skinWeight,
            new Float32Array(rest.length),
          ),
    );
    // Occluding attachments at one subdivision level, whatever this model's.
    const surfaces = this.attached.map((a) =>
      this.attachmentLevel === 1 ? a.part : part(this.attachmentSurface(a.asset, 1)),
    );
    // Every corner reuses the rest bake wherever nothing within reach moved.
    const atRest = this.bakeOcclusionAt(rest, surfaces, undefined);
    const bakes = [
      atRest.values,
      ...bodies.slice(1).map((body) => this.bakeOcclusionAt(body, surfaces, atRest).values),
    ];
    return this.attached.map((a, i) => {
      const n = a.asset.entry.vertexCount;
      const out = new Float32Array(n * bakes.length);
      bakes.forEach((b, k) => {
        out.set(b[i] as Float32Array, k * n);
      });
      return out;
    });
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

  /** Each bone's parent index in skin-weight order (-1 for the root). */
  boneParents(): Int16Array {
    return restBones(this.assets, this.assets.positions).parents;
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
    const baked = this.wearsPackedSet()
      ? this.attached.map(({ asset }) => Float32Array.from(asset.occlusion, (o) => o / 255))
      : this.bakeAttachmentOcclusion();
    // Carried to the render surface by the subdivision stencil, like any other
    // per-vertex field, three corners at a time (the stencil's stride).
    const corners = occlusionCorners(OCCLUSION_KEYS.length);
    const occlusion = this.attached.map(({ asset, part: p }, i) => {
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
    return {
      body: {
        ...topologyOf(this.body.mesh),
        layerFields: this.layerFields,
        layers: SKIN_LAYERS.map((l) => l.id),
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
   * The target files a recipe needs that have not arrived (empty when it can
   * be evaluated now). Validates the recipe first.
   */
  pendingTargetFiles(recipe: Recipe): Set<string> {
    return this.pendingFor(recipeContributions(recipe, this.assets.modifiers));
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

  evaluate(recipe: Recipe): Evaluation {
    const contributions = recipeContributions(recipe, this.assets.modifiers);
    const pending = this.pendingFor(contributions);
    if (pending.size)
      throw new MorphError(
        `the recipe needs target files that have not loaded yet: ${[...pending].join(", ")} ` +
          "(await their stage of loadHumanoidAssetsStaged)",
      );
    const control = new Float32Array(this.assets.positions.length);
    evaluateMorph(this.assets.positions, this.assets.targets, contributions, control, this.regions);
    let minY = Number.POSITIVE_INFINITY;
    for (const v of this.bodyVertices) minY = Math.min(minY, control[v * 3 + 1] as number);
    const body = this.evaluatePart(this.body, control);
    const attachments = this.attached.map((a) =>
      this.evaluatePart(a.part, evaluateBinding(a.asset, control, a.control)),
    );
    const curvature = meanCurvature(
      body.positions,
      body.normals,
      this.bodyEdges,
      new Float32Array(body.positions.length / 3),
    );
    const boneHeads = restBones(this.assets, control).heads;
    return { ...body, attachments, groundOffset: -minY, control, curvature, boneHeads };
  }

  private evaluatePart(p: Part, control: Float32Array): SurfaceEvaluation {
    const n = p.mesh.renderToSurface.length * 3;
    const positions = new Float32Array(n);
    const normals = new Float32Array(n);
    evaluateSurface(p.mesh, control, positions, normals, p.scratch);
    return { positions, normals };
  }
}
