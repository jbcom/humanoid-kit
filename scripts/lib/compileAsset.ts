/**
 * Compiles a MakeHuman-format asset (.mhclo + .obj + .mhmat + textures) into
 * the packed binding format the runtime evaluates (`src/mhclo/bound.ts`).
 *
 * Every file of the asset is judged together under `licenceRule.ts` before any
 * of it is used: a MakeHuman team asset by its own CC0 release header, a
 * community asset by its captured page stating CC0, or a CC0 mesh whose binding
 * is not CC0. In that last case the binding is rebuilt from the mesh against our
 * own base body (`bindToBody`), so nothing of the asset's binding file reaches
 * the pack, and a material or texture that is not CC0 is left out. Anything
 * that cannot prove CC0 is refused.
 */
import fs from "node:fs";
import path from "node:path";
import { parseMhclo } from "../../src/mhclo/parse.ts";
import { type BodyMesh, bindToBody } from "./hairCards/bind.ts";
import { type CommunityPage, judgeAsset } from "./licenceRule.ts";

export const MH_UNIT = 0.1;
/** How much of each file the licence rule reads: headers live at the top. */
const HEAD = 3000;
/** MakeHuman's z_depth when a binding does not give one. */
const DEFAULT_Z_DEPTH = 50;

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

/** A keyword line's value in an MHCLO file, read without touching its binding data. */
const keyword = (text: string, key: string) =>
  text.match(new RegExp(`^\\s*${key}\\s+(.+?)\\s*$`, "m"))?.[1] ?? null;

function parseObjAsset(text: string) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const faceVerts: number[] = [];
  const faceUvs: number[] = [];
  let vertexCount = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("v ")) {
      vertexCount++;
      const [, x, y, z] = line.split(/\s+/);
      positions.push(Number(x) * MH_UNIT, Number(y) * MH_UNIT, Number(z) * MH_UNIT);
    } else if (line.startsWith("vt ")) {
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
  return { vertexCount, positions, uvs, faceVerts, faceUvs };
}

const mhmatValue = (text: string, key: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/))
    .find((w) => w[0] === key);

/** The texture files a material names (diffuse, and the normal map when asked for). */
function materialTextures(text: string, matFile: string, normalMap: boolean) {
  const textureOf = (key: string): string | null => {
    const name = mhmatValue(text, key)?.slice(1).join(" ");
    if (!name) return null;
    const file = path.resolve(path.dirname(matFile), name);
    if (!fs.existsSync(file)) throw new Error(`${matFile}: texture ${name} not found`);
    return file;
  };
  return {
    diffuse: textureOf("diffuseTexture"),
    normal: normalMap ? textureOf("normalmapTexture") : null,
  };
}

function parseMhmat(text: string) {
  const get = (key: string) => mhmatValue(text, key);
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
  return {
    color,
    roughness: Math.min(1, Math.max(0.05, 1 - shininess)),
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
  /**
   * The asset's page on makehumancommunity.org, for a community asset. Without
   * it every file must carry MakeHuman's own CC0 release header (clause A).
   */
  page?: CommunityPage;
  /**
   * Pack the geometry and binding only, ignoring the asset's material: for an
   * attachment the kit draws with a material of its own (the nail plates).
   */
  geometryOnly?: boolean;
  /**
   * The base body, at rest in metres, to bind the mesh to when the asset's own
   * binding is not CC0 (clause M). Required for such an asset: its binding is
   * rebuilt from the mesh, and the asset's binding file is read only for its
   * licence and the names of its mesh and material.
   */
  body?: BodyMesh;
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
  const { materialFile, normalMap = false, page, geometryOnly = false, body } = options;
  const dir = path.dirname(mhcloFile);
  const mhcloText = fs.readFileSync(mhcloFile, "utf8");
  const objName = keyword(mhcloText, "obj_file");
  if (!objName) throw new Error(`${mhcloFile}: missing obj_file`);
  const objFile = path.resolve(dir, objName);
  const objText = fs.readFileSync(objFile, "utf8");
  const materialName = keyword(mhcloText, "material");
  const matPath = geometryOnly
    ? null
    : (materialFile ?? (materialName ? path.resolve(dir, materialName) : null));
  const matText = matPath ? fs.readFileSync(matPath, "utf8") : null;
  const textureFiles =
    matPath && matText !== null
      ? materialTextures(matText, matPath, normalMap)
      : { diffuse: null, normal: null };

  // Judge every file together before any of it is used.
  const files: { file: string; text: string | null }[] = [
    { file: mhcloFile, text: mhcloText },
    { file: objFile, text: objText },
    ...(matPath && matText !== null ? [{ file: matPath, text: matText }] : []),
    ...[textureFiles.diffuse, textureFiles.normal]
      .filter((f): f is string => f !== null)
      .map((file) => ({ file, text: null })),
  ];
  const judgement = judgeAsset(
    files.map(({ file, text }) => ({
      name: path.basename(file),
      text: text?.slice(0, HEAD) ?? null,
    })),
    page,
  );
  if (!judgement.pass) throw new Error(`licence gate: ${mhcloFile}: ${judgement.reason}`);
  const regenerate = new Set(judgement.regenerate);
  const exclude = new Set(judgement.exclude);
  const cite =
    judgement.clause === "B" && page ? ` (<${page.url}>, submitted ${page.submitted})` : "";
  const evidence: Record<string, string> = {};
  for (const { file } of files) {
    const name = path.basename(file);
    evidence[file] = regenerate.has(name)
      ? "M: binding is not CC0; not shipped, rebuilt from the CC0 mesh against our base"
      : exclude.has(name)
        ? "M: not CC0; not shipped"
        : `${judgement.evidence[name]}${cite}`;
  }

  const obj = parseObjAsset(objText);
  const binding = regenerate.has(path.basename(mhcloFile))
    ? regeneratedBinding(mhcloFile, objFile, obj.positions, body)
    : sourceBinding(mhcloFile, mhcloText, obj.vertexCount);

  const textures = new Map<string, string>();
  let material: AssetMaterial = {
    color: [1, 1, 1],
    roughness: 0.5,
    texture: null,
    transparent: false,
    alphaToCoverage: false,
    backfaceCull: true,
  };
  if (matPath && matText !== null && !exclude.has(path.basename(matPath))) {
    // Textures ship as WebP (see writeAttachments), named after the asset and source file.
    const packed = (source: string | null) => {
      if (!source || exclude.has(path.basename(source))) return null;
      const name = `${id.replace(/\//g, "_")}_${path.basename(source, path.extname(source))}.webp`;
      textures.set(source, name);
      return name;
    };
    material = {
      ...parseMhmat(matText),
      texture: packed(textureFiles.diffuse),
      ...(normalMap && { normalTexture: packed(textureFiles.normal) }),
    };
  }
  return {
    id,
    kind,
    name: binding.name,
    zDepth: binding.zDepth,
    vertexCount: obj.vertexCount,
    faceCount: obj.faceVerts.length / 4,
    scale: binding.scale,
    material,
    arrays: {
      refVerts: binding.refVerts,
      weights: binding.weights,
      offsets: binding.offsets,
      faceVerts: Uint32Array.from(obj.faceVerts),
      faceUvs: Uint32Array.from(obj.faceUvs),
      uvs: Float32Array.from(obj.uvs),
      deleteVerts: binding.deleteVerts,
    },
    evidence,
    textures,
  };
}

interface PackedBinding {
  name: string;
  zDepth: number;
  scale: CompiledAsset["scale"];
  refVerts: Uint32Array;
  weights: Float32Array;
  /** Metres. */
  offsets: Float32Array;
  deleteVerts: Uint32Array;
}

/** The asset's own binding, which the licence rule found CC0. */
function sourceBinding(mhcloFile: string, text: string, vertexCount: number): PackedBinding {
  const b = parseMhclo(text);
  if (vertexCount !== b.weights.length / 3)
    throw new Error(
      `${mhcloFile}: ${vertexCount} OBJ vertices but ${b.weights.length / 3} bindings`,
    );
  const s = b.scale;
  return {
    name: b.name,
    zDepth: b.zDepth,
    scale: s
      ? {
          x: [s.x.v1, s.x.v2, s.x.reference * MH_UNIT],
          y: [s.y.v1, s.y.v2, s.y.reference * MH_UNIT],
          z: [s.z.v1, s.z.v2, s.z.reference * MH_UNIT],
        }
      : null,
    refVerts: b.refVerts,
    weights: b.weights,
    offsets: b.offsets.map((o) => o * MH_UNIT),
    deleteVerts: b.deleteVerts,
  };
}

/**
 * A binding rebuilt from the CC0 mesh alone: each vertex bound to the nearest
 * triangle of our base body, unscaled, hiding no body vertices. The asset's own
 * binding file contributes nothing, not even its name or z-depth.
 */
function regeneratedBinding(
  mhcloFile: string,
  objFile: string,
  positions: number[],
  body: BodyMesh | undefined,
): PackedBinding {
  if (!body)
    throw new Error(
      `licence gate: ${mhcloFile}: its binding is not CC0; pass the base body so the binding is rebuilt from the CC0 mesh`,
    );
  const b = bindToBody(Float32Array.from(positions), body);
  return {
    name: path.basename(objFile, path.extname(objFile)),
    zDepth: DEFAULT_Z_DEPTH,
    scale: null,
    refVerts: b.refVerts,
    weights: b.weights,
    offsets: b.offsets,
    deleteVerts: new Uint32Array(0),
  };
}
