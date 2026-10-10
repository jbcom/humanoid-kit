/**
 * The foundation's geometric invariants (docs/FOUNDATION.md, "What the
 * foundation proves"), measured on a posed body against itself at rest:
 *
 * 1. no interpenetration: skin passes through skin by no more than
 *    `PENETRATION_LIMIT`, except between the named contact pairs
 *    (`CONTACT_PAIRS`), whose depth is reported apart;
 * 2. no collapse: no triangle inverts against the skinned normals or keeps
 *    under `SQUASH_LIMIT` of its rest area, and the skin round each joint keeps
 *    its volume within `VOLUME_BAND` of rest;
 * 3. a smooth surface: no edge folds sharper than `DIHEDRAL_LIMIT` in the pose
 *    where it was smooth at rest, outside the named creases;
 * 4. continuity: a UV seam's duplicates stay together.
 *
 * Colour and relief continuity across layers, and fair rendering by tone,
 * are measured where they are drawn (the browser tier).
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three";
import { INTERSECTED, MeshBVH, NOT_INTERSECTED } from "three-mesh-bvh";
import type { PosedBody } from "./posed.ts";

/** How far skin may pass through skin, metres, outside a named contact. */
export const PENETRATION_LIMIT = 0.002;
/** Skin this near a vertex at rest (metres) is its own neighbourhood, never a penetration. */
export const NEIGHBOURHOOD = 0.04;
/** How near the skin it has passed through a penetrating vertex lies, at most, metres. */
export const REACH = 0.03;
/** Triangles smaller than this at rest (m²) are degenerate, their shape noise: not measured. */
export const DEGENERATE_AREA = 1e-10;
/** A triangle keeping under this share of its rest area has collapsed. */
export const SQUASH_LIMIT = 0.3;
/** The share of rest volume the skin round a joint keeps, at least and at most. */
export const VOLUME_BAND = [0.8, 1.2] as const;
/** An edge folding sharper than this (degrees) in the pose, smooth at rest, is a fold. */
export const DIHEDRAL_LIMIT = 60;
/** At rest an edge under this (degrees) was smooth. */
export const DIHEDRAL_REST = 30;

/** A part of the body, for naming contacts: by the bone a vertex follows most. */
export type BodyPart =
  | "trunk"
  | "head"
  | `${"upperarm" | "forearm" | "hand" | "thigh" | "shin" | "foot"}.${"L" | "R"}`;

/** The part a bone belongs to. */
export function partOfBone(name: string): BodyPart {
  const side = name.endsWith(".R") ? "R" : "L";
  if (/^upperarm/.test(name)) return `upperarm.${side}`;
  if (/^lowerarm/.test(name)) return `forearm.${side}`;
  if (/^(wrist|metacarpal|finger)/.test(name)) return `hand.${side}`;
  if (/^upperleg/.test(name)) return `thigh.${side}`;
  if (/^lowerleg/.test(name)) return `shin.${side}`;
  if (/^(foot|toe)/.test(name)) return `foot.${side}`;
  if (/^(spine|pelvis|breast|clavicle|shoulder|root)/.test(name)) return "trunk";
  return "head";
}

/**
 * Parts whose skin may press together in a pose (docs/FOUNDATION.md: thigh on
 * calf in a squat, arm on chest when crossed), each unordered pair once, per
 * side. Skin of either passing into the other is a contact, reported apart
 * from penetration.
 */
export const CONTACT_PAIRS: readonly (readonly [string, string])[] = [
  ...(["L", "R"] as const).flatMap((s) => [
    [`thigh.${s}`, `shin.${s}`] as const,
    [`thigh.${s}`, "trunk"] as const,
    [`shin.${s}`, "trunk"] as const,
    [`foot.${s}`, "trunk"] as const,
    [`shin.${s}`, `foot.${s}`] as const,
    [`upperarm.${s}`, "trunk"] as const,
    [`forearm.${s}`, "trunk"] as const,
    [`hand.${s}`, "trunk"] as const,
    [`upperarm.${s}`, `forearm.${s}`] as const,
    [`hand.${s}`, `thigh.${s}`] as const,
    [`upperarm.${s}`, "head"] as const,
  ]),
  ["thigh.L", "thigh.R"],
];

const contactKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const CONTACTS = new Set(CONTACT_PAIRS.map(([a, b]) => contactKey(a, b)));

/** Whether skin of `a` pressing into skin of `b` is a named contact. */
export const isContact = (a: BodyPart, b: BodyPart): boolean =>
  a !== b && CONTACTS.has(contactKey(a, b));

/** What one posed body measures against each invariant. */
export interface InvariantMeasure {
  /** Vertices deeper than `PENETRATION_LIMIT` inside other skin, outside a named contact, and the deepest (metres). */
  penetrating: number;
  deepest: number;
  /** Where the deepest is: the two parts. */
  deepestParts: string;
  /** The same for named contacts. */
  contacts: number;
  deepestContact: number;
  /** Triangles that inverted against the skinned normals, or kept under `SQUASH_LIMIT` of their area. */
  inverted: number;
  squashed: number;
  /** Joints whose skin's volume left `VOLUME_BAND`, and the furthest ratio from 1. */
  volumeOut: string[];
  worstVolume: number;
  /** Edges folded past `DIHEDRAL_LIMIT` outside the named creases, and the sharpest (degrees). */
  folds: number;
  sharpest: number;
  /** The widest gap between a UV seam's duplicates (metres). */
  seamGap: number;
}

const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);

const v3 = (p: Float32Array, i: number, out: Vector3) =>
  out.set(p[i * 3] as number, p[i * 3 + 1] as number, p[i * 3 + 2] as number);

/** Each render vertex's part: the bone it follows most. */
export function vertexParts(body: PosedBody): BodyPart[] {
  const bones = body.bones.names.map(partOfBone);
  return Array.from({ length: body.vertexCount }, (_, v) => {
    let best = 0;
    for (let k = 1; k < 4; k++)
      if ((body.skinWeight[v * 4 + k] as number) > (body.skinWeight[v * 4 + best] as number))
        best = k;
    return bones[body.skinIndex[v * 4 + best] as number] as BodyPart;
  });
}

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const e1 = new Vector3();
const e2 = new Vector3();
const n = new Vector3();

/** A triangle's normal times twice its area. */
function areaNormal(p: Float32Array, i: number, j: number, k: number, out: Vector3): Vector3 {
  v3(p, i, a);
  v3(p, j, b);
  v3(p, k, c);
  return out.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
}

/**
 * Penetration: each sampled vertex, by the parity of a ray from it outward
 * along its normal. Skin is a closed surface, so a point on its outside
 * crosses it an even number of times on the way out; an odd number means the
 * vertex lies inside skin it has passed through. Its depth is how far the
 * nearest skin outside its rest neighbourhood is, which must be within
 * `REACH`, and the other part is the one the ray leaves through.
 */
function penetration(body: PosedBody, parts: BodyPart[], stride: number) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(body.positions, 3));
  geometry.setIndex(new BufferAttribute(Uint32Array.from(body.index), 1));
  const bvh = new MeshBVH(geometry, { verbose: false });
  // The BVH orders the index anew; triangle `t` is these three vertices.
  const tri = geometry.getIndex()?.array as Uint32Array;
  const p = new Vector3();
  const near = new Vector3();
  const rest = new Vector3();
  const corner = new Vector3();
  const ray = new Ray();
  const turned = new Vector3();
  let penetrating = 0;
  let deepest = 0;
  let deepestParts = "";
  let contacts = 0;
  let deepestContact = 0;
  for (let v = 0; v < body.vertexCount; v += stride) {
    if (body.weld[v] !== v) continue;
    v3(body.positions, v, p);
    v3(body.normals, v, n);
    if (n.lengthSq() === 0) continue;
    ray.origin.copy(p).addScaledVector(n.normalize(), 1e-4);
    ray.direction.copy(n);
    const hits = bvh.raycast(ray, DoubleSide);
    if (hits.length % 2 === 0) continue;
    // The skin is closed but for its openings (the eyes' sockets, the mouth):
    // a ray out through one miscounts, so a second, the normal tilted 27°
    // about a fixed axis square to it, must agree.
    turned.crossVectors(n, Math.abs(n.y) < 0.9 ? UP : RIGHT).normalize();
    ray.direction.copy(n).addScaledVector(turned, 0.5).normalize();
    if (bvh.raycast(ray, DoubleSide).length % 2 === 0) continue;
    ray.direction.copy(n);
    // Inside: the part it is inside of is the one the ray leaves through first.
    hits.sort((x, y) => x.distance - y.distance);
    const exit = hits[0]?.faceIndex;
    if (exit === undefined || exit === null) continue;
    const other = parts[tri[exit * 3] as number] as BodyPart;
    v3(body.rest, v, rest);
    let depth = REACH;
    bvh.shapecast({
      intersectsBounds: (box) => (box.distanceToPoint(p) < depth ? INTERSECTED : NOT_INTERSECTED),
      intersectsTriangle: (t, index) => {
        // The vertex's own neighbourhood at rest is never the skin it is inside.
        if (v3(body.rest, tri[index * 3] as number, corner).distanceTo(rest) < NEIGHBOURHOOD)
          return false;
        depth = Math.min(depth, t.closestPointToPoint(p, near).distanceTo(p));
        return false;
      },
    });
    // Inside skin with none of it within reach is a ray out through an opening,
    // not a penetration: skin a vertex has passed through lies near it.
    if (depth <= PENETRATION_LIMIT || depth >= REACH) continue;
    const mine = parts[v] as BodyPart;
    if (isContact(mine, other)) {
      contacts++;
      deepestContact = Math.max(deepestContact, depth);
    } else {
      penetrating++;
      if (depth > deepest) {
        deepest = depth;
        deepestParts = `${mine}~${other}`;
      }
    }
  }
  geometry.dispose();
  return { penetrating, deepest, deepestParts, contacts, deepestContact };
}

/** Inverted and squashed triangles. */
function collapse(body: PosedBody) {
  let inverted = 0;
  let squashed = 0;
  const posed = new Vector3();
  const atRest = new Vector3();
  const skinned = new Vector3();
  for (let t = 0; t < body.index.length; t += 3) {
    const [i, j, k] = [body.index[t], body.index[t + 1], body.index[t + 2]] as [
      number,
      number,
      number,
    ];
    areaNormal(body.positions, i, j, k, posed);
    areaNormal(body.rest, i, j, k, atRest);
    const restArea = atRest.length();
    if (restArea < 2 * DEGENERATE_AREA) continue;
    // Inverted: the face turned against its skinned normals where at rest it
    // agreed with them (a face that disagrees at rest, at a lip's or a lid's
    // edge, is the mesh's shape, not the pose's doing).
    skinned.set(0, 0, 0);
    for (const v of [i, j, k]) skinned.add(v3(body.normals, v, a));
    const restSkinned = b.set(0, 0, 0);
    for (const v of [i, j, k]) restSkinned.add(v3(body.restNormals, v, c));
    if (posed.dot(skinned) < 0 && atRest.dot(restSkinned) > 0) inverted++;
    else if (posed.length() < SQUASH_LIMIT * restArea) squashed++;
  }
  return { inverted, squashed };
}

/** Folds: welded edges sharper in the pose than `DIHEDRAL_LIMIT`, smooth at rest, outside creases. */
function folds(body: PosedBody, crease: Float32Array) {
  const edges = new Map<string, number[]>();
  const w = body.weld;
  for (let t = 0; t < body.index.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const p = w[body.index[t + e] as number] as number;
      const q = w[body.index[t + ((e + 1) % 3)] as number] as number;
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      const list = edges.get(key);
      if (list) list.push(t);
      else edges.set(key, [t]);
    }
  const angle = (pos: Float32Array, s: number, u: number) => {
    const n1 = areaNormal(
      pos,
      body.index[s] as number,
      body.index[s + 1] as number,
      body.index[s + 2] as number,
      new Vector3(),
    ).normalize();
    const n2 = areaNormal(
      pos,
      body.index[u] as number,
      body.index[u + 1] as number,
      body.index[u + 2] as number,
      new Vector3(),
    ).normalize();
    return (Math.acos(Math.min(1, Math.max(-1, n1.dot(n2)))) * 180) / Math.PI;
  };
  let count = 0;
  let sharpest = 0;
  for (const [key, tris] of edges) {
    if (tris.length !== 2) continue;
    const [p, q] = key.split(",").map(Number) as [number, number];
    if ((crease[p] as number) > 0.5 || (crease[q] as number) > 0.5) continue;
    const [s, u] = tris as [number, number];
    const restArea = (t: number) =>
      areaNormal(
        body.rest,
        body.index[t] as number,
        body.index[t + 1] as number,
        body.index[t + 2] as number,
        e1,
      ).length() / 2;
    if (restArea(s) < DEGENERATE_AREA || restArea(u) < DEGENERATE_AREA) continue;
    const posed = angle(body.positions, s, u);
    if (posed <= DIHEDRAL_LIMIT || angle(body.rest, s, u) >= DIHEDRAL_REST) continue;
    count++;
    sharpest = Math.max(sharpest, posed);
  }
  return { folds: count, sharpest };
}

/** The joints whose skin's volume is held: the bone whose head is the joint, and its parent. */
const VOLUME_JOINTS = [
  ...(["L", "R"] as const).flatMap((s) => [
    { name: `shoulder.${s}`, bones: [`upperarm01.${s}`, `clavicle.${s}`] },
    { name: `elbow.${s}`, bones: [`lowerarm01.${s}`, `upperarm02.${s}`] },
    { name: `hip.${s}`, bones: [`upperleg01.${s}`, `pelvis.${s}`] },
    { name: `knee.${s}`, bones: [`lowerleg01.${s}`, `upperleg02.${s}`] },
  ]),
];

/**
 * The volume the skin round each joint closes with the joint's head: the
 * signed volume of the cones from the head to the triangles whose vertices
 * follow the joint's two bones most, posed against rest.
 */
function jointVolumes(body: PosedBody) {
  const out: string[] = [];
  let worst = 1;
  const owner = Array.from({ length: body.vertexCount }, (_, v) => {
    let best = 0;
    for (let k = 1; k < 4; k++)
      if ((body.skinWeight[v * 4 + k] as number) > (body.skinWeight[v * 4 + best] as number))
        best = k;
    return body.skinIndex[v * 4 + best] as number;
  });
  for (const joint of VOLUME_JOINTS) {
    const ids = joint.bones.map((name) => body.bones.names.indexOf(name));
    if (ids.some((i) => i < 0)) continue;
    const head = ids[0] as number;
    const volume = (pos: Float32Array, heads: Float32Array) => {
      const o = new Vector3(
        heads[head * 3] as number,
        heads[head * 3 + 1] as number,
        heads[head * 3 + 2] as number,
      );
      let sum = 0;
      for (let t = 0; t < body.index.length; t += 3) {
        const [i, j, k] = [body.index[t], body.index[t + 1], body.index[t + 2]] as [
          number,
          number,
          number,
        ];
        if (![i, j, k].every((v) => ids.includes(owner[v] as number))) continue;
        v3(pos, i, a).sub(o);
        v3(pos, j, b).sub(o);
        v3(pos, k, c).sub(o);
        sum += a.dot(e1.crossVectors(b, c)) / 6;
      }
      return Math.abs(sum);
    };
    const atRest = volume(body.rest, body.bones.heads);
    if (atRest < 1e-9) continue;
    const ratio = volume(body.positions, body.heads) / atRest;
    if (Math.abs(ratio - 1) > Math.abs(worst - 1)) worst = ratio;
    if (ratio < VOLUME_BAND[0] || ratio > VOLUME_BAND[1])
      out.push(`${joint.name} ${ratio.toFixed(2)}`);
  }
  return { volumeOut: out, worstVolume: worst };
}

/** The widest gap between a UV seam's duplicates in the pose. */
function seamGap(body: PosedBody): number {
  let worst = 0;
  for (let v = 0; v < body.vertexCount; v++) {
    const w = body.weld[v] as number;
    if (w === v) continue;
    worst = Math.max(worst, v3(body.positions, v, a).distanceTo(v3(body.positions, w, b)));
  }
  return worst;
}

/**
 * Every invariant on one posed body. `crease` is the named creases' mask per
 * render vertex (`HumanoidModel.bodyField` of the crease layers' fields);
 * `stride` samples every `stride`-th vertex for penetration, the costly one.
 */
export function measureInvariants(
  body: PosedBody,
  crease: Float32Array,
  stride = 1,
): InvariantMeasure {
  const parts = vertexParts(body);
  return {
    ...penetration(body, parts, stride),
    ...collapse(body),
    ...jointVolumes(body),
    ...folds(body, crease),
    seamGap: seamGap(body),
  };
}
