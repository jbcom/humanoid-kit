/**
 * How far a posed body's skin passes through itself where a joint folds it
 * (docs/ARCHITECTURE.md, "The hip fold" and "The knee fold"), and the flaps a
 * fold leaves: the measures the folds' tests hold them to.
 *
 * Skin passes through skin where an edge of one part's mesh crosses a triangle
 * of another's: a fact of the posed mesh, which does not depend on which side
 * of any surface a point is judged to lie, so it does not flicker from one
 * pose to the next. How deep is how far behind the crossed triangle's plane
 * the edge's end lies, behind meaning on the body's inside: against the
 * triangle's face, unless the pose has turned it inside out.
 */
import { type HumanoidAssets, SKIN_INFLUENCES } from "../../src/format/assetFormat.ts";
import { DIHEDRAL_LIMIT, DIHEDRAL_REST } from "../../src/foundation/invariants.ts";
import { SurfaceDistance, TriangleCrossings } from "../../src/rig/contact.ts";
import {
  FOLD_BODIES,
  FOLD_FULL_REACH,
  FOLD_TRUNK_REACH,
  foldParts,
  nearHips,
  TRUNK_SHARE,
} from "../../src/rig/hipFold.ts";
import { boneMass } from "../../src/rig/jointFold.ts";
import { posedBones, type RestBones, rotateByBone } from "../../src/rig/pose.ts";
import { bodyTriangles } from "./skinMeasure.ts";

export interface Penetration {
  /** The deepest crossing, metres behind the crossed triangle (0 when none cross). */
  depth: number;
  /** Edges of the moving skin's mesh that cross the other's. */
  count: number;
}

/**
 * One part's skin (`movers`) against another's (`skin`, triangles): how far
 * the movers' edges pass through it.
 */
export class SkinCrossing {
  private readonly movers: Uint8Array;
  private readonly edges: [number, number][] = [];
  private readonly control: Float32Array;
  private readonly skin: Uint32Array;
  /** The skin's faces on the rest figure (`facesOn`), once asked for. */
  private atRest: Float32Array | undefined;

  /** `control`: the rest vertices, the upright the pose is judged against by default. */
  constructor(
    control: Float32Array,
    movers: Iterable<number>,
    skin: Uint32Array,
    tris: Uint32Array,
  ) {
    this.control = control;
    this.skin = skin;
    const n = control.length / 3;
    this.movers = new Uint8Array(n);
    for (const v of movers) this.movers[v] = 1;
    // Each edge of the body that has a moving vertex at an end, once.
    const seen = new Set<number>();
    for (let t = 0; t < tris.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = tris[t + k] as number;
        const b = tris[t + ((k + 1) % 3)] as number;
        if (!this.movers[a] && !this.movers[b]) continue;
        const key = a < b ? a * n + b : b * n + a;
        if (seen.has(key)) continue;
        seen.add(key);
        this.edges.push([a, b]);
      }
  }

  /**
   * The movers' penetration of the skin in the pose that put the body's
   * vertices at `positions`. A triangle of the skin the pose has turned inside
   * out (its normal more than 90° from the one it should face, `facing`'s: by
   * default its normal on the rest figure, for skin the pose does not turn)
   * faces into the body: what is behind it is judged from its other side.
   */
  penetration(positions: Float32Array, facing?: Float32Array): Penetration {
    const crossings = new TriangleCrossings(positions, this.skin);
    this.atRest ??= this.facesOn(this.control);
    const expected = facing ?? this.atRest;
    let depth = 0;
    let count = 0;
    const posed = new Float64Array(3);
    for (const [a, b] of this.edges) {
      const found = crossings.find(a, b);
      for (let h = 0; h < found; h++) {
        const t = crossings.hits[h] as number;
        crossings.normal(t, posed);
        const was = expected.subarray(t * 3, t * 3 + 3);
        const facing =
          (posed[0] as number) * (was[0] as number) +
          (posed[1] as number) * (was[1] as number) +
          (posed[2] as number) * (was[2] as number);
        const outside = facing < 0 ? -1 : 1;
        for (const v of [a, b])
          if (this.movers[v]) depth = Math.max(depth, -outside * crossings.side(t, v));
      }
      if (found) count++;
    }
    return { depth, count };
  }

  /** The skin's triangles' unit normals with the body's vertices at `positions`, three each. */
  facesOn(positions: Float32Array): Float32Array {
    const out = new Float32Array(this.skin.length);
    const at = new TriangleCrossings(positions, this.skin);
    const n = new Float64Array(3);
    for (let t = 0; t < this.skin.length / 3; t++) {
      at.normal(t, n);
      out.set(n, t * 3);
    }
    return out;
  }

  /** The skin's triangles. */
  get triangles(): Uint32Array {
    return this.skin;
  }
}

/**
 * The unit normals `skin`'s triangles (three corners each) face in a pose:
 * each rest normal (`rest` faces, from `SkinCrossing.restFaces`) carried by
 * its corners' bones by their weights, as the skin's normals are, so that a
 * triangle the bones turn whole (the calf's, with the shin) is judged by where
 * they turned it and not by where it faced at rest.
 */
export function carriedFaces(
  skin: Uint32Array,
  restFaces: Float32Array,
  bones: RestBones,
  rotations: Float32Array,
  skinIndex: ArrayLike<number>,
  skinWeight: ArrayLike<number>,
): Float32Array {
  const { world } = posedBones(bones, rotations);
  const out = new Float32Array(restFaces.length);
  for (let t = 0; t < skin.length / 3; t++) {
    const n0 = [restFaces[t * 3], restFaces[t * 3 + 1], restFaces[t * 3 + 2]] as [
      number,
      number,
      number,
    ];
    let x = 0;
    let y = 0;
    let z = 0;
    for (let c = 0; c < 3; c++) {
      const v = skin[t * 3 + c] as number;
      for (let k = 0; k < SKIN_INFLUENCES; k++) {
        const w = skinWeight[v * SKIN_INFLUENCES + k] as number;
        if (w === 0) continue;
        const [rx, ry, rz] = rotateByBone(world, skinIndex[v * SKIN_INFLUENCES + k] as number, n0);
        x += w * rx;
        y += w * ry;
        z += w * rz;
      }
    }
    const length = Math.hypot(x, y, z) || 1;
    out[t * 3] = x / length;
    out[t * 3 + 1] = y / length;
    out[t * 3 + 2] = z / length;
  }
  return out;
}

/**
 * The thigh through the trunk (docs/ARCHITECTURE.md, "The hip fold"): the skin
 * the thigh holds most of (a vertex whose weight on the thigh bones is over a
 * half, no more than `FOLD_FRONT_MARGIN` behind a hip and within the fold's
 * reach of it), against the skin the trunk holds most of.
 */
export class HipContact extends SkinCrossing {
  /** `rest` and `control`: the figure's skeleton and rest vertices. */
  constructor(
    assets: HumanoidAssets,
    rest: RestBones,
    control: Float32Array,
    tris: Uint32Array = bodyTriangles(assets),
  ) {
    const parts = foldParts(
      rest,
      control,
      assets.skinIndex,
      assets.skinWeight,
      tris,
      0.5,
      FOLD_FULL_REACH,
    );
    super(control, parts.movers, parts.skin, tris);
  }
}

/**
 * How far from a knee joint, as a share of the thigh's length (the hip's head
 * to the knee's), the calf's skin and the thigh's are taken to meet: a deeply
 * bent knee lays the calf along the back of the thigh's lower half and more.
 */
export const KNEE_CONTACT_REACH = 0.6;

/** The vertices of `control` within `share` of the thigh's length of a knee joint, as a mask. */
export function nearKnees(rest: RestBones, control: Float32Array, share: number): Uint8Array {
  const out = new Uint8Array(control.length / 3);
  for (const side of [".L", ".R"]) {
    const hip = rest.names.indexOf(`upperleg01${side}`);
    const knee = rest.names.indexOf(`lowerleg01${side}`);
    if (hip < 0 || knee < 0) continue;
    const at = (b: number, k: number) => rest.heads[b * 3 + k] as number;
    const reach =
      share *
      Math.hypot(at(knee, 0) - at(hip, 0), at(knee, 1) - at(hip, 1), at(knee, 2) - at(hip, 2));
    for (let v = 0; v < out.length; v++)
      if (
        Math.hypot(
          (control[v * 3] as number) - at(knee, 0),
          (control[v * 3 + 1] as number) - at(knee, 1),
          (control[v * 3 + 2] as number) - at(knee, 2),
        ) < reach
      )
        out[v] = 1;
  }
  return out;
}

/**
 * The calf and the thigh through each other at the knee (docs/ARCHITECTURE.md,
 * "The knee fold"): the skin the shin's bones hold over half of, within
 * `KNEE_CONTACT_REACH` of a knee, against the skin the thigh's hold over half
 * of there, each way. A knee bent to a right angle meets nothing, so what
 * crosses there is the back of the knee collapsed through itself.
 */
export class KneeContact {
  private readonly calfInThigh: SkinCrossing;
  private readonly thighInCalf: SkinCrossing;
  private readonly calfFaces: Float32Array;
  private readonly assets: HumanoidAssets;
  private readonly rest: RestBones;

  constructor(
    assets: HumanoidAssets,
    rest: RestBones,
    control: Float32Array,
    tris: Uint32Array = bodyTriangles(assets),
  ) {
    this.assets = assets;
    this.rest = rest;
    const near = nearKnees(rest, control, KNEE_CONTACT_REACH);
    const thighMass = boneMass(rest.names, assets.skinIndex, assets.skinWeight, FOLD_BODIES.thigh);
    const shinMass = boneMass(rest.names, assets.skinIndex, assets.skinWeight, /^lowerleg0[12]\./);
    const calf = (v: number) => near[v] === 1 && (shinMass[v] as number) > 0.5;
    const thigh = (v: number) => near[v] === 1 && (thighMass[v] as number) > 0.5;
    const skinOf = (part: (v: number) => boolean) => {
      const kept: number[] = [];
      for (let t = 0; t < tris.length; t += 3)
        if ([0, 1, 2].every((k) => part(tris[t + k] as number)))
          kept.push(tris[t] as number, tris[t + 1] as number, tris[t + 2] as number);
      return Uint32Array.from(kept);
    };
    const all = Array.from({ length: control.length / 3 }, (_, v) => v);
    this.calfInThigh = new SkinCrossing(control, all.filter(calf), skinOf(thigh), tris);
    this.thighInCalf = new SkinCrossing(control, all.filter(thigh), skinOf(calf), tris);
    this.calfFaces = this.thighInCalf.facesOn(control);
  }

  /**
   * The calf through the thigh and the thigh through the calf in the pose
   * `rotations` that put the body's vertices at `positions`: the deeper, and
   * the crossing edges of both. A knee bent moves the shin alone, so the
   * thigh's skin faces as at rest, and the calf's as the shin turned it
   * (`carriedFaces`).
   */
  penetrationBoth(
    positions: Float32Array,
    rotations: Float32Array,
  ): { calfInThigh: Penetration; thighInCalf: Penetration } {
    const turned = carriedFaces(
      this.thighInCalf.triangles,
      this.calfFaces,
      this.rest,
      rotations,
      this.assets.skinIndex,
      this.assets.skinWeight,
    );
    return {
      calfInThigh: this.calfInThigh.penetration(positions),
      thighInCalf: this.thighInCalf.penetration(positions, turned),
    };
  }

  /** The deeper of `penetrationBoth`'s two, and the crossing edges of both. */
  penetration(positions: Float32Array, rotations: Float32Array): Penetration {
    const { calfInThigh: a, thighInCalf: b } = this.penetrationBoth(positions, rotations);
    return { depth: Math.max(a.depth, b.depth), count: a.count + b.count };
  }
}

/** What `PressReach` measures in one pose. */
export interface Reach {
  /** The deepest the fold moves the trunk's skin (metres). */
  deepest: number;
  /** The deepest it moves trunk skin lying farther than `far` from the thigh's skin (metres). */
  apart: number;
}

/**
 * Whether the fold presses the trunk only where a thigh touches it
 * (docs/ARCHITECTURE.md, "The hip fold"): how far the fold moves the trunk's
 * skin (the vertices the trunk holds as much of as a thigh, in front of the
 * hips) that lies farther than `far` from any of the thighs' skin in the pose.
 * Skin no thigh touches has nothing pressing it.
 */
export class PressReach {
  private readonly trunk: Uint32Array;
  private readonly thighTris: Uint32Array;

  constructor(
    rest: RestBones,
    control: Float32Array,
    skinIndex: ArrayLike<number>,
    skinWeight: ArrayLike<number>,
    tris: Uint32Array,
  ) {
    const thigh = boneMass(rest.names, skinIndex, skinWeight, FOLD_BODIES.thigh);
    const trunk = boneMass(rest.names, skinIndex, skinWeight, FOLD_BODIES.trunk);
    const front = nearHips(rest, control, FOLD_TRUNK_REACH, true);
    const isThigh = (v: number) => (thigh[v] as number) > (trunk[v] as number);
    const kept: number[] = [];
    for (let t = 0; t < tris.length; t += 3)
      if ([0, 1, 2].every((k) => isThigh(tris[t + k] as number)))
        kept.push(tris[t] as number, tris[t + 1] as number, tris[t + 2] as number);
    this.thighTris = Uint32Array.from(kept);
    const trunkSkin: number[] = [];
    for (let v = 0; v < thigh.length; v++)
      if (front[v] && (trunk[v] as number) >= TRUNK_SHARE && !isThigh(v)) trunkSkin.push(v);
    this.trunk = Uint32Array.from(trunkSkin);
  }

  /** The fold's reach over the trunk in the pose that put the body at `bare` without it and at `folded` with it. */
  measure(bare: Float32Array, folded: Float32Array, far: number): Reach {
    const thighs = new SurfaceDistance(folded, this.thighTris);
    let deepest = 0;
    let apart = 0;
    for (const v of this.trunk) {
      const moved = Math.hypot(
        (folded[v * 3] as number) - (bare[v * 3] as number),
        (folded[v * 3 + 1] as number) - (bare[v * 3 + 1] as number),
        (folded[v * 3 + 2] as number) - (bare[v * 3 + 2] as number),
      );
      if (moved === 0) continue;
      deepest = Math.max(deepest, moved);
      const d = thighs.distance(
        folded[v * 3] as number,
        folded[v * 3 + 1] as number,
        folded[v * 3 + 2] as number,
        far,
      );
      if (d > far) apart = Math.max(apart, moved);
    }
    return { deepest, apart };
  }
}

/** Each vertex's unit normal on `positions`: its triangles' (`tris`) normals, each weighted by its area. */
export function vertexNormals(positions: Float32Array, tris: Uint32Array): Float32Array {
  const sum = new Float64Array(positions.length);
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]] as [number, number, number];
    const p = (v: number, k: number) => positions[v * 3 + k] as number;
    const u = [p(b, 0) - p(a, 0), p(b, 1) - p(a, 1), p(b, 2) - p(a, 2)] as const;
    const w = [p(c, 0) - p(a, 0), p(c, 1) - p(a, 1), p(c, 2) - p(a, 2)] as const;
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const v of [a, b, c])
      for (let k = 0; k < 3; k++) sum[v * 3 + k] = (sum[v * 3 + k] as number) + (n[k] as number);
  }
  const out = new Float32Array(positions.length);
  for (let v = 0; v < out.length / 3; v++) {
    const l =
      Math.hypot(sum[v * 3] as number, sum[v * 3 + 1] as number, sum[v * 3 + 2] as number) || 1;
    for (let k = 0; k < 3; k++) out[v * 3 + k] = (sum[v * 3 + k] as number) / l;
  }
  return out;
}

/** What `Flaps` counts in one pose. */
export interface FlapCount {
  /** Triangles turned against their skinned normals that agreed with them at rest. */
  inverted: number;
  /** Edges folded sharper than `DIHEDRAL_LIMIT` that were smoother than `DIHEDRAL_REST` at rest. */
  folded: number;
}

/** The hip crease's zone: the skin within `FOLD_FULL_REACH` of a hip and in front of it, the belly, the groin and the thigh's front. */
export const creaseZone = (rest: RestBones, control: Float32Array): Uint8Array =>
  nearHips(rest, control, FOLD_FULL_REACH, true);

/**
 * How far from a knee joint, as a share of the thigh's length, the knee's flaps
 * are counted: the back of the knee, the kneecap and the skin either side.
 */
export const KNEE_FLAP_REACH = 0.3;

/** The knee's zone: the skin within `KNEE_FLAP_REACH` of a knee joint. */
export const kneeZone = (rest: RestBones, control: Float32Array): Uint8Array =>
  nearKnees(rest, control, KNEE_FLAP_REACH);

/**
 * Flaps a pose leaves in a zone of the skin (`creaseZone`, `kneeZone`): the
 * foundation's collapse and fold invariants (src/foundation/invariants.ts)
 * over the triangles all of whose corners the zone holds, where a fold that
 * pushes skin past its neighbours, or bones that fold it over itself, turn it
 * into flaps with lit edges.
 */
export class Flaps {
  /** The zone's triangles, three corners each, and its edges with their two triangles (offsets into `tris`). */
  private readonly tris: Uint32Array;
  private readonly edges: [number, number][] = [];
  private readonly rest: Float32Array;
  private readonly restNormals: Float32Array;

  constructor(
    control: Float32Array,
    restNormals: Float32Array,
    tris: Uint32Array,
    zone: Uint8Array,
  ) {
    this.rest = control;
    this.restNormals = restNormals;
    const kept: number[] = [];
    for (let t = 0; t < tris.length; t += 3)
      if (zone[tris[t] as number] && zone[tris[t + 1] as number] && zone[tris[t + 2] as number])
        kept.push(tris[t] as number, tris[t + 1] as number, tris[t + 2] as number);
    this.tris = Uint32Array.from(kept);
    const n = control.length / 3;
    const sides = new Map<number, number[]>();
    for (let t = 0; t < this.tris.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = this.tris[t + k] as number;
        const b = this.tris[t + ((k + 1) % 3)] as number;
        const key = a < b ? a * n + b : b * n + a;
        const list = sides.get(key);
        if (list) list.push(t);
        else sides.set(key, [t]);
      }
    for (const list of sides.values())
      if (
        list.length === 2 &&
        this.dihedral(control, list[0] as number, list[1] as number) < DIHEDRAL_REST
      )
        this.edges.push([list[0] as number, list[1] as number]);
  }

  /** Triangle `t`'s (an offset into `tris`) normal on `positions`, times twice its area. */
  private face(positions: Float32Array, t: number): [number, number, number] {
    const [a, b, c] = [this.tris[t], this.tris[t + 1], this.tris[t + 2]] as [
      number,
      number,
      number,
    ];
    const p = (v: number, k: number) => positions[v * 3 + k] as number;
    const u = [p(b, 0) - p(a, 0), p(b, 1) - p(a, 1), p(b, 2) - p(a, 2)] as const;
    const w = [p(c, 0) - p(a, 0), p(c, 1) - p(a, 1), p(c, 2) - p(a, 2)] as const;
    return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  }

  /** The angle (degrees) between triangles `s` and `t`'s faces on `positions`. */
  private dihedral(positions: Float32Array, s: number, t: number): number {
    const m = this.face(positions, s);
    const n = this.face(positions, t);
    const cos =
      (m[0] * n[0] + m[1] * n[1] + m[2] * n[2]) / (Math.hypot(...m) * Math.hypot(...n) || 1);
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  }

  /** The flaps of the pose that put the body's vertices at `positions`, with skinned `normals`. */
  count(positions: Float32Array, normals: Float32Array): FlapCount {
    let inverted = 0;
    for (let t = 0; t < this.tris.length; t += 3) {
      const posed = this.face(positions, t);
      const atRest = this.face(this.rest, t);
      let now = 0;
      let then = 0;
      for (let c = 0; c < 3; c++) {
        const v = this.tris[t + c] as number;
        for (let k = 0; k < 3; k++) {
          now += (posed[k] as number) * (normals[v * 3 + k] as number);
          then += (atRest[k] as number) * (this.restNormals[v * 3 + k] as number);
        }
      }
      if (now < 0 && then > 0) inverted++;
    }
    let folded = 0;
    for (const [s, t] of this.edges) if (this.dihedral(positions, s, t) > DIHEDRAL_LIMIT) folded++;
    return { inverted, folded };
  }
}
