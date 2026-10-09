/**
 * Where on the body a skin state shows, measured from the base mesh alone.
 *
 * The base mesh is a frozen contract, so a zone is derived from data it already
 * carries rather than from new targets: the skeleton's skin weights (a bone's
 * weight is a soft mask of the flesh it moves, `buildBoneField`), the vertex
 * normals (which side of the hand, the foot or the trunk a vertex is on), and
 * the joints' positions (the eyes' height, which way the thumb lies). Every
 * zone is a per-vertex field in 0..1 with soft edges, and is measured once per
 * set of assets.
 */
import type { HumanoidAssets } from "../../format/assetFormat.ts";
import { jointPosition } from "../../format/assetFormat.ts";
import { buildBoneField } from "../../makehuman/regions.ts";

/**
 * The skeleton's bones in the regions skin states differ by: finer than the
 * shape traits' (`BODY_REGIONS`), since a sweat map separates forearm from
 * upper arm and thigh from shin. Bones named for no zone move the face.
 */
export const SKIN_ZONES = [
  "head",
  "neck",
  "breast",
  "upperTrunk",
  "lowerTrunk",
  "pelvis",
  "upperArm",
  "forearm",
  "hand",
  "thigh",
  "shin",
  "foot",
] as const;
export type SkinZone = (typeof SKIN_ZONES)[number];

/** The zone a bone's skin weight counts towards. */
export function zoneOfBone(bone: string): SkinZone {
  if (/^breast\./.test(bone)) return "breast";
  if (/^neck0/.test(bone)) return "neck";
  if (/^(spine01|spine02|clavicle)/.test(bone)) return "upperTrunk";
  if (/^(spine03|spine04)$/.test(bone)) return "lowerTrunk";
  if (/^(spine05|root|pelvis)/.test(bone)) return "pelvis";
  if (/^(shoulder|upperarm)/.test(bone)) return "upperArm";
  if (/^lowerarm/.test(bone)) return "forearm";
  if (/^(wrist|metacarpal|finger)/.test(bone)) return "hand";
  if (/^upperleg/.test(bone)) return "thigh";
  if (/^lowerleg/.test(bone)) return "shin";
  if (/^(foot|toe)/.test(bone)) return "foot";
  return "head";
}

export interface SkinZones {
  /** Per zone, soft masks that sum to 1 at every base vertex. */
  zone(name: SkinZone): Float32Array;
  /** Unit vertex normals of the body, three floats per base vertex. */
  normals: Float32Array;
  /** 1 facing forward (the chest, the belly), 0 facing back, eased across the flanks. */
  front: Float32Array;
  /** The palmar side of the hands: hairless, glabrous skin. */
  palm: Float32Array;
  /** The soles of the feet. */
  sole: Float32Array;
}

const ramp = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Area-weighted unit vertex normals over the body's faces. */
function vertexNormals(assets: HumanoidAssets): Float32Array {
  const n = assets.manifest.vertexCount;
  const P = assets.positions;
  const out = new Float32Array(n * 3);
  const group = assets.manifest.groups.find((g) => g.name === "body");
  if (!group) return out;
  for (let f = group.faceStart; f < group.faceStart + group.faceCount; f++) {
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number) as [
      number,
      number,
      number,
      number,
    ];
    // The cross product of a quad's diagonals: its normal, scaled by its area.
    const d1 = [0, 1, 2].map((k) => (P[c * 3 + k] as number) - (P[a * 3 + k] as number));
    const d2 = [0, 1, 2].map((k) => (P[d * 3 + k] as number) - (P[b * 3 + k] as number));
    const cross = [
      (d1[1] as number) * (d2[2] as number) - (d1[2] as number) * (d2[1] as number),
      (d1[2] as number) * (d2[0] as number) - (d1[0] as number) * (d2[2] as number),
      (d1[0] as number) * (d2[1] as number) - (d1[1] as number) * (d2[0] as number),
    ];
    for (const v of [a, b, c, d])
      for (let k = 0; k < 3; k++)
        out[v * 3 + k] = (out[v * 3 + k] as number) + (cross[k] as number);
  }
  for (let v = 0; v < n; v++) {
    const len = Math.hypot(
      out[v * 3] as number,
      out[v * 3 + 1] as number,
      out[v * 3 + 2] as number,
    );
    if (len > 0) for (let k = 0; k < 3; k++) out[v * 3 + k] = (out[v * 3 + k] as number) / len;
  }
  return out;
}

/**
 * The unit direction the palm faces on one hand: the cross product of the hand's
 * axis (wrist to the middle fingertip) and the way its thumb lies (the little
 * finger's base to the thumb's), mirrored for the right hand.
 */
function palmDirection(assets: HumanoidAssets, side: "L" | "R"): [number, number, number] {
  const at = (joint: string) => {
    const p = new Float32Array(3);
    jointPosition(assets, assets.positions, joint, p, 0);
    return p;
  };
  const wrist = at(`wrist.${side}____head`);
  const tip = at(`finger3-3.${side}____tail`);
  const thumb = at(`finger1-1.${side}____head`);
  const little = at(`finger5-1.${side}____head`);
  const axis = [0, 1, 2].map((k) => (tip[k] as number) - (wrist[k] as number));
  const across = [0, 1, 2].map((k) => (thumb[k] as number) - (little[k] as number));
  const cross = [
    (axis[1] as number) * (across[2] as number) - (axis[2] as number) * (across[1] as number),
    (axis[2] as number) * (across[0] as number) - (axis[0] as number) * (across[2] as number),
    (axis[0] as number) * (across[1] as number) - (axis[1] as number) * (across[0] as number),
  ];
  const sign = side === "L" ? 1 : -1;
  const len = Math.hypot(...(cross as [number, number, number])) || 1;
  return cross.map((c) => (sign * c) / len) as [number, number, number];
}

const cache = new WeakMap<HumanoidAssets, SkinZones>();

/** The zones of a base mesh, measured on first use. */
export function skinZones(assets: HumanoidAssets): SkinZones {
  const known = cache.get(assets);
  if (known) return known;
  const n = assets.manifest.vertexCount;
  const P = assets.positions;
  const field = buildBoneField(
    assets,
    SKIN_ZONES,
    (bone) => SKIN_ZONES.indexOf(zoneOfBone(bone)),
    SKIN_ZONES.indexOf("upperTrunk"),
  );
  const zone = (name: SkinZone) => field.masks[SKIN_ZONES.indexOf(name)] as Float32Array;
  const normals = vertexNormals(assets);

  const front = new Float32Array(n);
  const palm = new Float32Array(n);
  const sole = new Float32Array(n);
  const hand = zone("hand");
  const foot = zone("foot");
  const palmDir = { L: palmDirection(assets, "L"), R: palmDirection(assets, "R") };
  for (let v = 0; v < n; v++) {
    const nx = normals[v * 3] as number;
    const ny = normals[v * 3 + 1] as number;
    const nz = normals[v * 3 + 2] as number;
    front[v] = ramp(-0.3, 0.3, nz);
    // The hands lie well off the midline: a vertex's side is its sign of x.
    const dir = palmDir[(P[v * 3] as number) >= 0 ? "L" : "R"];
    palm[v] = (hand[v] as number) * ramp(0, 0.45, nx * dir[0] + ny * dir[1] + nz * dir[2]);
    sole[v] = (foot[v] as number) * ramp(0.35, 0.75, -ny);
  }
  const zones: SkinZones = { zone, normals, front, palm, sole };
  cache.set(assets, zones);
  return zones;
}
