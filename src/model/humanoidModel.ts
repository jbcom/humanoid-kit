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
import { applyStencil, type Stencil } from "../subdiv/catmullClark.ts";
import { buildLayerFields } from "../surface/layers.ts";
import { bakeOcclusion } from "../surface/occlusion.ts";
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
   * Per render vertex: how open it is to light (1) or enclosed by the figure (0),
   * baked against the default figure (lids over eyes, lips over teeth).
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
   * lids and lips sit as on most figures. Rays start from the control vertices
   * (a quarter of the render vertices); occluders are the unsubdivided body and
   * the opaque attachments at one subdivision level, whatever this model's
   * level, so the result depends only on the packs and the worn set.
   */
  bakeAttachmentOcclusion(): Float32Array[] {
    const rest = this.evaluate(occlusionFigure());
    const occluders = this.attached.flatMap((a, i) => {
      // Transparent attachments (the eyes, whose cornea dome is cut away by the
      // texture's alpha) would block light they do not block when rendered.
      if (a.asset.entry.material.transparent) return [];
      if (this.attachmentLevel === 1)
        return [
          {
            positions: (rest.attachments[i] as SurfaceEvaluation).positions,
            index: a.part.mesh.index,
          },
        ];
      const p = part(this.attachmentSurface(a.asset, 1));
      return [{ positions: this.evaluatePart(p, a.control).positions, index: p.mesh.index }];
    });
    return bakeOcclusion(
      [{ positions: rest.control, index: this.bodyControlTriangles }, ...occluders],
      this.attached.map((a) => ({
        positions: a.control,
        normals: quadVertexNormals(a.control, a.asset.faceVerts),
      })),
      { rays: 32 },
    );
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
    return worn.size === this.attached.length && worn.size === this.assets.attachments.size;
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
    // per-vertex field.
    const occlusion = this.attached.map(({ part: p }, i) => {
      const control = baked[i] as Float32Array;
      const field = new Float32Array(control.length * 3);
      control.forEach((o, v) => {
        field.fill(o, v * 3, v * 3 + 3);
      });
      const surface = applyStencil(
        p.mesh.stencil,
        field,
        new Float32Array(p.mesh.topology.vertexCount * 3),
      );
      return Float32Array.from(p.mesh.renderToSurface, (s) => surface[s * 3] as number);
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
    return { ...body, attachments, groundOffset: -minY, control, curvature };
  }

  private evaluatePart(p: Part, control: Float32Array): SurfaceEvaluation {
    const n = p.mesh.renderToSurface.length * 3;
    const positions = new Float32Array(n);
    const normals = new Float32Array(n);
    evaluateSurface(p.mesh, control, positions, normals, p.scratch);
    return { positions, normals };
  }
}
