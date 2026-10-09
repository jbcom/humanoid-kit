/**
 * Compiles a MakeHuman-format asset (.mhclo + .obj + .mhmat + textures) into
 * the packed binding format the runtime evaluates (`src/mhclo/bound.ts`).
 *
 * Licence evidence is taken from each file's own content; a texture has no
 * header of its own and inherits the licence of the material that references
 * it, which must itself prove CC0. Anything that cannot prove CC0 is refused.
 */
import fs from "node:fs";
import path from "node:path";
import { parseMhclo } from "../../src/mhclo/parse.ts";

export const MH_UNIT = 0.1;

export interface CompiledAsset {
  id: string;
  kind: string;
  name: string;
  zDepth: number;
  vertexCount: number;
  faceCount: number;
  /** Reference distances per axis: [v1, v2, reference metres]. */
  scale: {
    x: [number, number, number];
    y: [number, number, number];
    z: [number, number, number];
  } | null;
  material: AssetMaterial;
  /** Typed arrays to place in the pack binary. */
  arrays: {
    refVerts: Uint32Array;
    weights: Float32Array;
    /** Offsets in metres (MakeHuman decimetres × 0.1), before axis scaling. */
    offsets: Float32Array;
    faceVerts: Uint32Array;
    faceUvs: Uint32Array;
    uvs: Float32Array;
    deleteVerts: Uint32Array;
  };
  /** Source files this asset was compiled from, with their licence evidence. */
  evidence: Record<string, string>;
  /** Texture files (absolute source path → packed file name). */
  textures: Map<string, string>;
}

export interface AssetMaterial {
  color: [number, number, number];
  /** 0..1, derived from MakeHuman's shininess. */
  roughness: number;
  texture: string | null;
  /** Packed tangent-space normal map; present only when `compileAsset` was asked for normal maps. */
  normalTexture?: string | null;
  transparent: boolean;
  alphaToCoverage: boolean;
  backfaceCull: boolean;
}

/**
 * The evidence that a text asset is CC0, from the asset's own head: the header
 * MakeHuman wrote into every file of its CC0 release ("This asset was
 * explicitly released as CC0 in september 2020"). A bare `license CC0` line
 * proves nothing: community exporters write it by default, and a file in the
 * same download can contradict it (the sibling `.obj` of a "CC0" garment often
 * says AGPL3). Throws when the head does not carry the header.
 */
export function proveCc0(file: string, text: string): string {
  if (/released as CC0/.test(text.slice(0, 3000)))
    return 'file header: "This asset was explicitly released as CC0"';
  throw new Error(`licence gate: ${file} does not prove CC0`);
}

function readProven(file: string, evidence: Record<string, string>): string {
  const text = fs.readFileSync(file, "utf8");
  evidence[file] = proveCc0(file, text);
  return text;
}

function parseObjAsset(text: string) {
  const uvs: number[] = [];
  const faceVerts: number[] = [];
  const faceUvs: number[] = [];
  let vertexCount = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("v ")) vertexCount++;
    else if (line.startsWith("vt ")) {
      const [, u, v] = line.split(/\s+/);
      uvs.push(Number(u), Number(v));
    } else if (line.startsWith("f ")) {
      const corners = line.split(/\s+/).slice(1);
      if (corners.length !== 4) throw new Error(`asset OBJ face is not a quad: ${line}`);
      for (const c of corners) {
        const [vi, ti] = c.split("/");
        faceVerts.push(Number(vi) - 1);
        faceUvs.push(Number(ti) - 1);
      }
    }
  }
  return { vertexCount, uvs, faceVerts, faceUvs };
}

function parseMhmat(
  text: string,
  dir: string,
  evidence: Record<string, string>,
  matFile: string,
  normalMap: boolean,
) {
  const get = (key: string) =>
    text
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/))
      .find((w) => w[0] === key);
  const color = (get("diffuseColor")?.slice(1, 4).map(Number) ?? [1, 1, 1]) as [
    number,
    number,
    number,
  ];
  const shininess = Number(get("shininess")?.[1] ?? 0.5);
  const flag = (k: string, def: boolean) => {
    const v = get(k)?.[1];
    return v === undefined ? def : v.toLowerCase() === "true";
  };
  // A texture has no header of its own: it inherits the licence of the material
  // that names it, which has just proved CC0.
  const textureOf = (key: string): string | null => {
    const name = get(key)?.slice(1).join(" ");
    if (!name) return null;
    const file = path.resolve(dir, name);
    if (!fs.existsSync(file)) throw new Error(`${matFile}: texture ${name} not found`);
    evidence[file] = `texture referenced by ${path.basename(matFile)}, which proves CC0`;
    return file;
  };
  return {
    color,
    roughness: Math.min(1, Math.max(0.05, 1 - shininess)),
    texture: textureOf("diffuseTexture"),
    normalTexture: normalMap ? textureOf("normalmapTexture") : null,
    transparent: flag("transparent", false),
    alphaToCoverage: flag("alphaToCoverage", false),
    backfaceCull: flag("backfaceCull", true),
  };
}

export interface CompileOptions {
  /** The material (.mhmat) to use in place of the one the .mhclo names. */
  materialFile?: string;
  /**
   * Also pack the material's tangent-space normal map (`AssetMaterial.normalTexture`).
   * Off by default, so the body pack's attachments are packed exactly as before.
   */
  normalMap?: boolean;
}

/**
 * @param mhcloFile path to the .mhclo
 * @param id stable asset id within its pack, e.g. `eyes/high-poly`
 * @param kind attachment kind, e.g. `eyes`
 */
export function compileAsset(
  mhcloFile: string,
  id: string,
  kind: string,
  options: CompileOptions = {},
): CompiledAsset {
  const { materialFile, normalMap = false } = options;
  const evidence: Record<string, string> = {};
  const dir = path.dirname(mhcloFile);
  const binding = parseMhclo(readProven(mhcloFile, evidence));
  const obj = parseObjAsset(readProven(path.resolve(dir, binding.objFile), evidence));
  if (obj.vertexCount !== binding.weights.length / 3) {
    throw new Error(
      `${mhcloFile}: ${obj.vertexCount} OBJ vertices but ${binding.weights.length / 3} bindings`,
    );
  }
  const matPath = materialFile ?? (binding.material ? path.resolve(dir, binding.material) : null);
  const textures = new Map<string, string>();
  let material: AssetMaterial = {
    color: [1, 1, 1],
    roughness: 0.5,
    texture: null,
    transparent: false,
    alphaToCoverage: false,
    backfaceCull: true,
  };
  if (matPath) {
    const {
      texture: textureSource,
      normalTexture: normalSource,
      ...rest
    } = parseMhmat(
      readProven(matPath, evidence),
      path.dirname(matPath),
      evidence,
      matPath,
      normalMap,
    );
    // Textures ship as WebP (see writeAttachments), named after the asset and source file.
    const packed = (source: string | null) => {
      if (!source) return null;
      const name = `${id.replace(/\//g, "_")}_${path.basename(source, path.extname(source))}.webp`;
      textures.set(source, name);
      return name;
    };
    material = {
      ...rest,
      texture: packed(textureSource),
      ...(normalMap && { normalTexture: packed(normalSource) }),
    };
  }
  const s = binding.scale;
  return {
    id,
    kind,
    name: binding.name,
    zDepth: binding.zDepth,
    vertexCount: obj.vertexCount,
    faceCount: obj.faceVerts.length / 4,
    scale: s
      ? {
          x: [s.x.v1, s.x.v2, s.x.reference * MH_UNIT],
          y: [s.y.v1, s.y.v2, s.y.reference * MH_UNIT],
          z: [s.z.v1, s.z.v2, s.z.reference * MH_UNIT],
        }
      : null,
    material,
    arrays: {
      refVerts: binding.refVerts,
      weights: binding.weights,
      offsets: binding.offsets.map((o) => o * MH_UNIT),
      faceVerts: Uint32Array.from(obj.faceVerts),
      faceUvs: Uint32Array.from(obj.faceUvs),
      uvs: Float32Array.from(obj.uvs),
      deleteVerts: binding.deleteVerts,
    },
    evidence,
    textures,
  };
}
