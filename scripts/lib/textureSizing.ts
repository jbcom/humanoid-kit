/**
 * How big each packed texture is, and from what (docs/evidence/upscale.md):
 * the packers' one policy.
 *
 * A texture ships at the edge it needs at its closest QA framing
 * (`scripts/lib/texelBudget.ts`), never below its pack's default nor above
 * `TEXTURE_CEILING`, re-sourced from the original wherever the original has
 * that many texels. Where it does not, the texture ships at the original's own
 * size and the shortfall is recorded: no upscale ships, because none measured
 * closer to a larger original than the GPU's own magnification by a visible
 * margin (scripts/research/upscale-eval.ts). `scripts/upscale.ts` upscales the
 * shortfalls, gated, for inspection.
 */
import path from "node:path";
import sharp from "sharp";
import type { CompiledAsset } from "./compileAsset.ts";
import {
  type BoundMesh,
  boundTriangles,
  framingOf,
  neededEdge,
  shippedEdge,
  TEXTURE_CEILING,
} from "./texelBudget.ts";

/** A compiled asset as the texel measurement reads it. */
export const compiledMesh = (c: CompiledAsset): BoundMesh => ({
  ...c.arrays,
  entry: { scale: c.scale, vertexCount: c.vertexCount, faceCount: c.faceCount },
});

export interface TextureRecord {
  /** The packed file. */
  texture: string;
  /** Its source, relative to the system assets, and that source's longest edge. */
  source: string;
  sourceEdge: number;
  framing: string;
  needed: number;
  /** The longest edge shipped. */
  edge: number;
}

export interface PackTexture<R> {
  asset: CompiledAsset;
  /** The source image (absolute) and the packed file it becomes. */
  source: string;
  dest: string;
  /** The pack's default longest edge: need only raises it. */
  floor: number;
  /** The body's base positions (metres), which the asset binds to. */
  base: Float32Array;
  systemDir: string;
  /** Writes `source` to `dest` at no more than `edge` texels a side, the pack's own way. */
  encode: (source: string, dest: string, edge: number) => Promise<R>;
}

/**
 * Sizes and writes one texture by the policy above; returns what it decided
 * and what `encode` returned.
 */
export async function packTexture<R>(
  t: PackTexture<R>,
): Promise<{ record: TextureRecord; encoded: R }> {
  const framing = framingOf(t.asset.kind);
  const needed = neededEdge(boundTriangles(compiledMesh(t.asset), t.base), framing);
  const meta = await sharp(t.source).metadata();
  const sourceEdge = Math.max(meta.width as number, meta.height as number);
  const record: TextureRecord = {
    texture: path.basename(t.dest),
    source: path.relative(t.systemDir, t.source),
    sourceEdge,
    framing,
    needed,
    edge: shippedEdge(needed, sourceEdge, t.floor),
  };
  return { record, encoded: await t.encode(t.source, t.dest, record.edge) };
}

/** The PROVENANCE.md section that lists every texture's size, its source and any shortfall. */
export function textureProvenance(records: readonly TextureRecord[]): string[] {
  const from = (r: TextureRecord) => {
    const wanted = Math.min(r.needed, TEXTURE_CEILING);
    if (wanted > r.sourceEdge)
      return `the source, ${wanted - r.sourceEdge} texels short; not upscaled`;
    return r.edge < r.sourceEdge ? "the source, downsampled" : "the source";
  };
  return [
    "## Texture sizes",
    "",
    "Each texture ships at the edge its closest QA framing needs, re-sourced from the original wherever the original",
    "has those texels; where it has fewer, at the original's size, since no upscale measured closer to a larger",
    "original than the GPU's own magnification (`scripts/lib/textureSizing.ts`, docs/evidence/upscale.md).",
    "",
    "| Texture | Source | Source edge | Framing | Needs | Ships | From |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...records.map(
      (r) =>
        `| ${r.texture} | ${r.source} | ${r.sourceEdge} | ${r.framing} | ${r.needed} | ${r.edge} | ${from(r)} |`,
    ),
    "",
  ];
}
