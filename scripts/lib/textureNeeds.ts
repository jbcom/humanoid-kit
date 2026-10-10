/**
 * What every texture the committed packs ship needs (scripts/lib/texelBudget.ts),
 * matched to the MakeHuman system-assets image it was packed from: what
 * `scripts/research/texel-density.ts` reports and `scripts/upscale.ts` plans from.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  type AttachmentMaterial,
  addHairStyle,
  type ClothingManifest,
  type HairManifest,
  type HumanoidAssets,
  parseHumanoidAssets,
} from "../../src/format/assetFormat.ts";
import { bodyPackFiles, gunzipFile } from "./bodyPack.ts";
import {
  type BoundMesh,
  boundTriangles,
  COVERAGE,
  type FramingId,
  framingOf,
  neededEdge,
  shippedEdge,
  TEXTURE_CEILING,
  type Tri,
  texelDensity,
} from "./texelBudget.ts";
import type { UpscaleRequest } from "./upscale/upscaleTexture.ts";

/** What a texture's channels mean, which decides how it may be upscaled. */
export type TextureRole = "albedo" | "normal" | "strand" | "coverage";

/**
 * How each role could be upscaled without inventing anything. A coverage
 * texture (a brow's or a lash's) is packed from its source's alpha, so it is
 * upscaled as an albedo whose alpha is a cut-out. A strand map's luminance is
 * strand detail, which no method may invent, so a hair style is never upscaled.
 */
export const UPSCALE_CLASS: Partial<Record<TextureRole, UpscaleRequest["cls"]>> = {
  albedo: "albedo",
  normal: "normal",
  coverage: "albedo",
};

/** One upscale per short source, at the largest edge any texture packed from it needs. */
export function upscaleCandidates(
  needs: readonly TextureNeed[],
): Omit<UpscaleRequest, "systemDir">[] {
  const plan = new Map<string, Omit<UpscaleRequest, "systemDir">>();
  for (const n of needs) {
    const edge = Math.min(n.needed, TEXTURE_CEILING);
    const cls = UPSCALE_CLASS[n.role];
    if (edge <= n.sourceEdge || !cls) continue;
    const prior = plan.get(n.source);
    if (!prior || prior.edge < edge)
      plan.set(n.source, {
        source: n.source,
        cls,
        cutout: n.cutout || n.role === "coverage",
        edge,
        framing: n.framing,
        needed: n.needed,
      });
  }
  return [...plan.values()];
}

export interface TextureNeed {
  pack: "body" | "hair" | "clothing";
  /** The asset's id in its pack. */
  surface: string;
  /** The packed file and its longest edge. */
  texture: string;
  edge: number;
  role: TextureRole;
  /** Its alpha is a cut-out (alpha-to-coverage or alpha-blended), a coverage mask. */
  cutout: boolean;
  framing: FramingId;
  /** The source image (absolute) and its longest edge. */
  source: string;
  sourceEdge: number;
  /** Area-weighted median texels/mm, and the density `COVERAGE` of the area meets, shipped and at the source. */
  median: number;
  covered: number;
  coveredAtSource: number;
  /** The edge it needs (`neededEdge`), and what the packers' policy ships from the source alone. */
  needed: number;
  policy: number;
  /** Its triangles on the default figure. */
  tris: Tri[];
}

const json = <T>(file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as T;

/** The committed body, hair and clothing packs under `packsDir`, every style and garment loaded. */
export function readPacks(packsDir: string): HumanoidAssets {
  const dir = (p: string) => path.join(packsDir, p, "data");
  const clothing = json<ClothingManifest>(path.join(dir("clothing"), "manifest.json"));
  const hair = json<HairManifest>(path.join(dir("hair"), "manifest.json"));
  const assets = parseHumanoidAssets(
    bodyPackFiles(dir("body")),
    undefined,
    { manifest: clothing, garments: gunzipFile(dir("clothing"), clothing.garments.file) },
    { manifest: hair },
  );
  for (const s of hair.styles) addHairStyle(assets, s.id, gunzipFile(dir("hair"), s.file));
  return assets;
}

/**
 * The system-assets image a packed texture came from: the packers name a
 * texture `<asset id>_<source stem>.webp` (a hair style's `<style>.webp`, from
 * its folder's `_diffuse` image). Where several folders hold an image of that
 * stem (every teeth shape has a `teeth.png`), the asset id names the folder.
 * Undefined when none matches (a texture the packer draws itself); throws when
 * several still do.
 */
export function sourceOf(
  systemDir: string,
  images: readonly string[],
  packed: string,
): string | undefined {
  const stem = path.basename(packed, ".webp");
  const named = images.filter((f) => {
    const s = path.basename(f).replace(/\.[^.]+$/, "");
    const folder = path.basename(path.dirname(f));
    return stem.endsWith(`_${s}`) || s === stem || (folder === stem && s.endsWith("_diffuse"));
  });
  // A texture the packer draws itself (an authored or derived hair style, body hair) has none.
  if (!named.length) return undefined;
  const inFolder = named.filter((f) => stem.includes(path.basename(path.dirname(f))));
  const hits = named.length > 1 ? inFolder : named;
  if (hits.length !== 1)
    throw new Error(`${packed}: ${hits.length} source images match (${hits.join(", ")})`);
  return path.join(systemDir, hits[0] as string);
}

const edgeOf = async (file: string) => {
  const m = await sharp(file).metadata();
  return Math.max(m.width as number, m.height as number);
};

/** Every packed texture's need, against the source it came from. */
export async function textureNeeds(packsDir: string, systemDir: string): Promise<TextureNeed[]> {
  const assets = readPacks(packsDir);
  const images = fs
    .readdirSync(systemDir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.startsWith("skins"));
  const out: TextureNeed[] = [];
  const add = async (
    pack: TextureNeed["pack"],
    surface: string,
    kind: string,
    asset: BoundMesh & { entry: { material: AttachmentMaterial } },
    texture: string,
    role: TextureRole,
  ) => {
    const source = sourceOf(systemDir, images, texture);
    // Nothing to re-source or upscale from: the packer drew it at the size it wanted.
    if (!source) return;
    const tris = boundTriangles(asset, assets.positions);
    const framing = framingOf(kind);
    const edge = await edgeOf(path.join(packsDir, pack, "data", texture));
    const sourceEdge = await edgeOf(source);
    const needed = neededEdge(tris, framing);
    const m = asset.entry.material;
    out.push({
      pack,
      surface,
      texture,
      edge,
      role,
      cutout: role !== "normal" && (m.alphaToCoverage || m.transparent),
      framing,
      source,
      sourceEdge,
      median: texelDensity(tris, edge, edge, 0.5),
      covered: texelDensity(tris, edge, edge, 1 - COVERAGE),
      coveredAtSource: texelDensity(tris, sourceEdge, sourceEdge, 1 - COVERAGE),
      needed,
      policy: shippedEdge(needed, sourceEdge, edge),
      tris,
    });
  };
  for (const [id, a] of assets.attachments)
    if (a.entry.material.texture)
      await add("body", id, a.entry.kind, a, a.entry.material.texture, "albedo");
  for (const [id, a] of assets.hair?.bound ?? []) {
    const kind = assets.hair?.styles.get(id)?.kind ?? "scalp";
    if (a.entry.material.texture)
      await add(
        "hair",
        id,
        kind,
        a,
        a.entry.material.texture,
        kind === "scalp" ? "strand" : "coverage",
      );
  }
  for (const [id, g] of assets.garments) {
    if (g.entry.material.texture)
      await add("clothing", id, g.entry.kind, g, g.entry.material.texture, "albedo");
    if (g.entry.material.normalTexture)
      await add("clothing", id, g.entry.kind, g, g.entry.material.normalTexture, "normal");
  }
  return out;
}
