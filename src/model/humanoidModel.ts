/**
 * The evaluation pipeline for one loaded body pack:
 * recipe → regional macro + modifier contributions → morphed control mesh →
 * subdivided body surface, plus every bound attachment (eyes, teeth, tongue,
 * and later hair and clothing) placed on that same morphed mesh.
 * Framework-free; runs in a worker or on the main thread.
 */
import { buildSurfaceMesh, evaluateSurface, type SurfaceMesh } from "../build/surfaceMesh.ts";
import {
  type AttachmentMaterial,
  type BoundAsset,
  groupFaces,
  type HumanoidAssets,
} from "../format/assetFormat.ts";
import { recipeContributions } from "../makehuman/recipeMorph.ts";
import { buildRegionField } from "../makehuman/regions.ts";
import { bindingSkin, evaluateBinding } from "../mhclo/bound.ts";
import { evaluateMorph, type RegionField } from "../morph/evaluate.ts";
import type { Recipe } from "../recipe/recipe.ts";

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
}

export interface ModelTopology {
  body: SurfaceTopology;
  attachments: AttachmentTopology[];
}

export interface SurfaceEvaluation {
  positions: Float32Array;
  normals: Float32Array;
}

export interface Evaluation extends SurfaceEvaluation {
  /** One entry per attachment, in `ModelTopology.attachments` order. */
  attachments: SurfaceEvaluation[];
  /** Lift (metres) that puts the lowest body point on y = 0. */
  groundOffset: number;
  /** Morphed control positions (base topology), for joints, bindings and measurement. */
  control: Float32Array;
}

interface Part {
  mesh: SurfaceMesh;
  scratch: { surface: Float32Array; normals: Float32Array };
}

const part = (mesh: SurfaceMesh): Part => {
  const n = mesh.topology.vertexCount * 3;
  return { mesh, scratch: { surface: new Float32Array(n), normals: new Float32Array(n) } };
};

const topologyOf = (m: SurfaceMesh): SurfaceTopology => ({
  index: m.index,
  uvs: m.uvs,
  skinIndex: m.skinIndex,
  skinWeight: m.skinWeight,
  vertexCount: m.renderToSurface.length,
});

export class HumanoidModel {
  readonly regions: RegionField;
  private readonly body: Part;
  private readonly bodyVertices: Uint32Array;
  private readonly attached: { asset: BoundAsset; part: Part; control: Float32Array }[];

  constructor(
    readonly assets: HumanoidAssets,
    options: ModelOptions = {},
  ) {
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

    this.attached = wearing.map((asset) => {
      const skin = bindingSkin(asset, assets.skinIndex, assets.skinWeight);
      const mesh = buildSurfaceMesh(
        {
          vertexCount: asset.entry.vertexCount,
          faceVerts: asset.faceVerts,
          faceUvs: asset.faceUvs,
          uvs: asset.uvs,
          skinIndex: skin.index,
          skinWeight: skin.weight,
        },
        null,
        Math.min(level, 1),
      );
      return { asset, part: part(mesh), control: new Float32Array(asset.entry.vertexCount * 3) };
    });
  }

  topology(): ModelTopology {
    return {
      body: topologyOf(this.body.mesh),
      attachments: this.attached.map(({ asset, part: p }) => ({
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

  evaluate(recipe: Recipe): Evaluation {
    const control = new Float32Array(this.assets.positions.length);
    evaluateMorph(
      this.assets.positions,
      this.assets.targets,
      recipeContributions(recipe, this.assets.modifiers),
      control,
      this.regions,
    );
    let minY = Number.POSITIVE_INFINITY;
    for (const v of this.bodyVertices) minY = Math.min(minY, control[v * 3 + 1] as number);
    const body = this.evaluatePart(this.body, control);
    const attachments = this.attached.map((a) =>
      this.evaluatePart(a.part, evaluateBinding(a.asset, control, a.control)),
    );
    return { ...body, attachments, groundOffset: -minY, control };
  }

  private evaluatePart(p: Part, control: Float32Array): SurfaceEvaluation {
    const n = p.mesh.renderToSurface.length * 3;
    const positions = new Float32Array(n);
    const normals = new Float32Array(n);
    evaluateSurface(p.mesh, control, positions, normals, p.scratch);
    return { positions, normals };
  }
}
