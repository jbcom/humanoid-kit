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
  transparent: boolean;
  alphaToCoverage: boolean;
  backfaceCull: boolean;
}

function proveCc0(file: string, text: string): string {
  const head = text.slice(0, 3000);
  if (/released as CC0/.test(head))
    return 'file header: "This asset was explicitly released as CC0"';
  const line = head.split(/\r?\n/).find((l) => /^#\s*license\b/i.test(l) || /^license\b/i.test(l));
  if (line && /\bCC0\b/i.test(line) && !/AGPL|GPL|BY/i.test(line))
    return `file header: "${line.trim()}"`;
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

function parseMhmat(text: string, dir: string, evidence: Record<string, string>, matFile: string) {
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
  const textureName = get("diffuseTexture")?.slice(1).join(" ") ?? null;
  const flag = (k: string, def: boolean) => {
    const v = get(k)?.[1];
    return v === undefined ? def : v.toLowerCase() === "true";
  };
  let texture: string | null = null;
  if (textureName) {
    texture = path.resolve(dir, textureName);
    if (!fs.existsSync(texture)) throw new Error(`${matFile}: texture ${textureName} not found`);
    evidence[texture] = `texture referenced by ${path.basename(matFile)}, which proves CC0`;
  }
  return {
    color,
    roughness: Math.min(1, Math.max(0.05, 1 - shininess)),
    texture,
    transparent: flag("transparent", false),
    alphaToCoverage: flag("alphaToCoverage", false),
    backfaceCull: flag("backfaceCull", true),
  };
}

/**
 * @param mhcloFile path to the .mhclo
 * @param id stable asset id within its pack, e.g. `eyes/high-poly`
 * @param kind attachment kind, e.g. `eyes`
 * @param materialFile optional override for the material (.mhmat) to use
 */
export function compileAsset(
  mhcloFile: string,
  id: string,
  kind: string,
  materialFile?: string,
): CompiledAsset {
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
    const { texture: textureSource, ...rest } = parseMhmat(
      readProven(matPath, evidence),
      path.dirname(matPath),
      evidence,
      matPath,
    );
    const packedName = textureSource
      ? `${id.replace(/\//g, "_")}_${path.basename(textureSource)}`
      : null;
    if (textureSource && packedName) textures.set(textureSource, packedName);
    material = { ...rest, texture: packedName };
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
