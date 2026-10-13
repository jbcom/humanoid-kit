/**
 * The foundation's geometric invariants (docs/FOUNDATION.md, "What the
 * foundation proves"), measured on a posed body against itself at rest:
 *
 * 1. no interpenetration: skin passes through skin by no more than
 *    `PENETRATION_LIMIT`, except between the named contact pairs
 *    (`CONTACT_PAIRS`), whose depth is reported apart, and a canal's lumen
 *    self-contact (`isLumenContact`), reported apart too;
 * 2. no collapse: no triangle inverts against the skinned normals or keeps
 *    under `SQUASH_LIMIT` of its rest area, and the flesh round each joint keeps
 *    its volume within `VOLUME_BAND` of rest (`jointVolume`: what the skin
 *    encloses, overlaps once);
 * 3. a smooth surface: no edge folds sharper than `DIHEDRAL_LIMIT` in the pose
 *    where it was smooth at rest, outside the named creases;
 * 4. continuity: a UV seam's duplicates stay together.
 *
 * Colour and relief continuity across layers, and fair rendering by tone,
 * are measured where they are drawn (the browser tier).
 */
import { DoubleSide, Ray, Vector3 } from "three";
import { INTERSECTED, NOT_INTERSECTED } from "three-mesh-bvh";
import { SolidWinding } from "../rig/contact.ts";
import type { PosedBody } from "./posed.ts";
import { BodySurface } from "./surface.ts";

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

/**
 * Lumen self-contact (coordinator ruling, 2026-10-10): a canal
 * (`AdultReservoirSpec.canal`) is collapsed, a potential space whose walls touch
 * at rest, so a wall inside the opposite wall of its own canal is contact, not
 * penetration, while it stays inside the canal: vertex `v` is in it when it and
 * every corner of the triangle its ray leaves through first (`exit`) are of the same
 * canal, and that triangle lies within the canal's closed gap of it along the ray
 * (`exitDistance`). A wall that has crossed the opposite one leaves through other
 * skin, and skin passing through skin beside a canal is not of it: both are
 * penetration still.
 */
export function isLumenContact(
  canals: PosedBody["canals"],
  index: Uint32Array,
  v: number,
  exit: number,
  exitDistance: number,
): boolean {
  if (!canals) return false;
  const c = canals.of[v] as number;
  if (c < 0) return false;
  for (let k = 0; k < 3; k++) if (canals.of[index[exit * 3 + k] as number] !== c) return false;
  return exitDistance <= (canals.gap[c] as number);
}

/** What one posed body measures against each invariant. */
export interface InvariantMeasure {
  /** Vertices deeper than `PENETRATION_LIMIT` inside other skin, outside a named contact, and the deepest (metres). */
  penetrating: number;
  /**
   * The rest skin those vertices stand for (cm²): each sampled vertex's share
   * of its triangles' rest area, times the sampling stride. Penetration is
   * judged by this; the count is information, since a finer surface has more
   * vertices over the same skin.
   */
  penetratingArea: number;
  deepest: number;
  /** Where the deepest is: the two parts. */
  deepestParts: string;
  /** The same for named contacts. */
  contacts: number;
  deepestContact: number;
  /** Vertices in a canal's lumen self-contact (`isLumenContact`), and the rest skin they stand for (cm²). */
  lumen: number;
  lumenArea: number;
  /** Triangles that inverted against the skinned normals, or kept under `SQUASH_LIMIT` of their area. */
  inverted: number;
  squashed: number;
  /** The squashed triangles' rest area (cm²), by which collapse to a sliver is judged; the count is information. */
  squashedArea: number;
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

/** Square metres to square centimetres. */
const CM2 = 1e4;

/** Each welded vertex's share of its triangles' rest area (m²): a third of each, gathered on the weld's root. */
function restVertexAreas(body: PosedBody): Float32Array {
  const out = new Float32Array(body.vertexCount);
  const area = new Vector3();
  for (let t = 0; t < body.index.length; t += 3) {
    const corners = [body.index[t], body.index[t + 1], body.index[t + 2]] as [
      number,
      number,
      number,
    ];
    const third = areaNormal(body.rest, ...corners, area).length() / 6;
    for (const v of corners) {
      const root = body.weld[v] as number;
      out[root] = (out[root] as number) + third;
    }
  }
  return out;
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
  const surface = new BodySurface(body);
  const { bvh, triangles: tri } = surface;
  const areas = restVertexAreas(body);
  let penetratingArea = 0;
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
  let lumen = 0;
  let lumenArea = 0;
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
    // A canal's walls closing on each other: contact, inside the canal only (`isLumenContact`).
    if (isLumenContact(body.canals, tri, v, exit, (hits[0]?.distance ?? 0) + 1e-4)) {
      lumen++;
      lumenArea += (areas[v] as number) * stride * CM2;
    } else if (isContact(mine, other)) {
      contacts++;
      deepestContact = Math.max(deepestContact, depth);
    } else {
      penetrating++;
      penetratingArea += (areas[v] as number) * stride * CM2;
      if (depth > deepest) {
        deepest = depth;
        deepestParts = `${mine}~${other}`;
      }
    }
  }
  surface.dispose();
  return {
    penetrating,
    penetratingArea,
    deepest,
    deepestParts,
    contacts,
    deepestContact,
    lumen,
    lumenArea,
  };
}

/** Inverted and squashed triangles. */
function collapse(body: PosedBody) {
  let inverted = 0;
  let squashed = 0;
  let squashedArea = 0;
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
    else if (posed.length() < SQUASH_LIMIT * restArea) {
      squashed++;
      squashedArea += (restArea / 2) * CM2;
    }
  }
  return { inverted, squashed, squashedArea };
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

/**
 * The joints whose flesh's volume is held: the bone whose head is the joint,
 * and the two whose heads' distance (the limb segment beside it: the thigh at
 * the hip and the knee, the upper arm at the shoulder and the elbow) sizes the
 * ball it is measured in (`jointVolume`).
 */
export const VOLUME_JOINTS = [
  ...(["L", "R"] as const).flatMap((s) => [
    {
      name: `shoulder.${s}`,
      head: `upperarm01.${s}`,
      span: [`upperarm01.${s}`, `lowerarm01.${s}`],
    },
    { name: `elbow.${s}`, head: `lowerarm01.${s}`, span: [`upperarm01.${s}`, `lowerarm01.${s}`] },
    { name: `hip.${s}`, head: `upperleg01.${s}`, span: [`upperleg01.${s}`, `lowerleg01.${s}`] },
    { name: `knee.${s}`, head: `lowerleg01.${s}`, span: [`upperleg01.${s}`, `lowerleg01.${s}`] },
  ]),
];

/**
 * The radius of a joint's ball, as a share of its limb segment's length, and
 * the grid's cells across the ball. CHOICE: 0.3 (13 cm at an adult's knee,
 * 9 cm at the shoulder) holds the flesh a joint's bend moves and little of
 * what it does not; 24 cells, cells of 1 cm at the knee: the average man
 * turned and carried rigidly three ways reads his eight joints within 0.8% of
 * 1, 22 of the 24 readings within 0.4% (2026-10-10).
 */
export const VOLUME_RADIUS = 0.3;
export const VOLUME_CELLS = 24;

/**
 * The volume of flesh round `joint` (of `VOLUME_JOINTS`), posed against rest:
 * what the skin encloses (`SolidWinding`, winding at least once) within a
 * ball centred on the joint's head, of `VOLUME_RADIUS` of its limb segment's
 * length at rest. A limb turned rigidly about the joint keeps as much of
 * itself within the ball, so the ratio is what the skinning (and a fold) do to
 * the flesh. Skin that passes through skin encloses the overlap once, not
 * twice, as a sum of cones from the joint counted it: a calf through the
 * thigh is flesh lost, not flesh kept. Null where the skeleton has not the
 * joint's bones. `rest` and `posed` are the body at rest and posed
 * (`SolidWinding` of each), with the bones' heads there.
 */
export function jointVolume(
  names: readonly string[],
  joint: (typeof VOLUME_JOINTS)[number],
  rest: { solid: SolidWinding; heads: Float32Array },
  posed: { solid: SolidWinding; heads: Float32Array },
): number | null {
  const head = names.indexOf(joint.head);
  const [s0, s1] = joint.span.map((name) => names.indexOf(name)) as [number, number];
  if (head < 0 || s0 < 0 || s1 < 0) return null;
  const at = (heads: Float32Array, b: number) =>
    [0, 1, 2].map((k) => heads[b * 3 + k] as number) as [number, number, number];
  const [p, q] = [at(rest.heads, s0), at(rest.heads, s1)];
  const r = VOLUME_RADIUS * Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  const atRest = rest.solid.ballVolume(at(rest.heads, head), r, VOLUME_CELLS);
  if (atRest <= 0) return null;
  return posed.solid.ballVolume(at(posed.heads, head), r, VOLUME_CELLS) / atRest;
}

/** Every joint of `VOLUME_JOINTS` whose flesh's volume leaves `VOLUME_BAND` (`jointVolume`), and the furthest ratio from 1. */
function jointVolumes(body: PosedBody) {
  const out: string[] = [];
  let worst = 1;
  const rest = { solid: new SolidWinding(body.rest, body.index), heads: body.bones.heads };
  const posed = { solid: new SolidWinding(body.positions, body.index), heads: body.heads };
  for (const joint of VOLUME_JOINTS) {
    const ratio = jointVolume(body.bones.names, joint, rest, posed);
    if (ratio === null) continue;
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
