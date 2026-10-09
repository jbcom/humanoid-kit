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
} from "../format/assetFormat.ts";
import { recipeContributions } from "../makehuman/recipeMorph.ts";
import { buildRegionField } from "../makehuman/regions.ts";
import { buildSkinMasks } from "../makehuman/skinMasks.ts";
import { bindingSkin, evaluateBinding } from "../mhclo/bound.ts";
import { evaluateMorph, MorphError, type RegionField } from "../morph/evaluate.ts";
import { createRecipe, type Recipe, recipeSetsModifiers } from "../recipe/recipe.ts";
import { applyStencil } from "../subdiv/catmullClark.ts";
import { bakeOcclusion } from "../surface/occlusion.ts";

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
    /** Per render vertex: lips, flush and areola mask weights (see `buildSkinMasks`). */
    skinMask: Float32Array;
  };
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

export class HumanoidModel {
  readonly regions: RegionField;
  private readonly body: Part;
  private readonly bodyVertices: Uint32Array;
  private readonly bodyControlTriangles: Uint32Array;
  private readonly bodyEdges: Uint32Array;
  private readonly attached: { asset: BoundAsset; part: Part; control: Float32Array }[];
  private readonly skinMask: Float32Array;

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
    // The unsubdivided body as triangles: a cheap occluder for baking attachment occlusion.
    this.bodyControlTriangles = new Uint32Array(bodyFaces.length * 6);
    bodyFaces.forEach((f, i) => {
      const q = [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number);
      this.bodyControlTriangles.set([q[0], q[1], q[2], q[0], q[2], q[3]] as number[], i * 6);
    });
    // Skin masks are static: interpolate the base-vertex masks through the subdivision stencil once.
    const surfaceMask = applyStencil(
      this.body.mesh.stencil,
      buildSkinMasks(assets),
      new Float32Array(this.body.mesh.topology.vertexCount * 3),
    );
    this.bodyEdges = triangleEdges(this.body.mesh.index);
    const r2s = this.body.mesh.renderToSurface;
    this.skinMask = new Float32Array(r2s.length * 3);
    r2s.forEach((s, r) => {
      this.skinMask.set(surfaceMask.subarray(s * 3, s * 3 + 3), r * 3);
    });

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
    // Occlusion is geometry the figure creates around its attachments; baked once
    // against the default figure, where lids and lips sit as on most figures.
    // Rays start from each attachment's control vertices (a quarter of the render
    // vertices) and the result is carried to the render surface by the subdivision
    // stencil, like any other per-vertex field.
    const rest = this.evaluate(createRecipe());
    const baked = bakeOcclusion(
      [
        { positions: rest.control, index: this.bodyControlTriangles },
        // Transparent attachments (the eyes, whose cornea dome is cut away by the
        // texture's alpha) would block light they do not block when rendered.
        ...this.attached.flatMap((a, i) =>
          a.asset.entry.material.transparent
            ? []
            : [
                {
                  positions: (rest.attachments[i] as SurfaceEvaluation).positions,
                  index: a.part.mesh.index,
                },
              ],
        ),
      ],
      this.attached.map((a) => ({
        positions: a.control,
        normals: quadVertexNormals(a.control, a.asset.faceVerts),
      })),
      { rays: 32 },
    );
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
      body: { ...topologyOf(this.body.mesh), skinMask: this.skinMask },
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

  evaluate(recipe: Recipe): Evaluation {
    if (!this.assets.modifierTargetsLoaded && recipeSetsModifiers(recipe))
      throw new MorphError(
        "the recipe sets shape modifiers, and the modifier targets have not loaded yet " +
          "(await the second stage of loadHumanoidAssetsStaged)",
      );
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
