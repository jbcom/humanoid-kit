import { describe, expect, it } from "vitest";
import {
  DUAL_TEXELS,
  dualBones,
  dualBoneTexels,
  skinNormalsBlended,
  skinNormalsDual,
  skinPositionsBlended,
  skinPositionsDual,
} from "../src/rig/dual.ts";
import { IDENTITY_POSE, posedBones, restBonesFrom, skinPositions } from "../src/rig/pose.ts";
import { mul, type Quat, rotate } from "../src/rig/quat.ts";

/** Two bones stacked along y: `a` at the origin, `b` (its child) at (0, 1, 0). */
const limb = () =>
  restBonesFrom(["a", "b"], Int16Array.from([-1, 0]), Float32Array.from([0, 0, 0, 0, 1, 0]));

/** A rotation of `degrees` about the axis (x, y, z) as a quaternion. */
const turn = (x: number, y: number, z: number, degrees: number): number[] => {
  const h = (degrees * Math.PI) / 360;
  const s = Math.sin(h) / Math.hypot(x, y, z);
  return [x * s, y * s, z * s, Math.cos(h)];
};

/** The pose that turns bone `bone` of a two-bone rig and leaves the other alone. */
const posing = (bone: number, q: number[]) => {
  const r = IDENTITY_POSE(2);
  r.set(q, bone * 4);
  return r;
};

const both = (weightA: number): { index: Uint8Array; weight: Float32Array } => ({
  index: Uint8Array.from([0, 1, 0, 0]),
  weight: Float32Array.from([weightA, 1 - weightA, 0, 0]),
});

const skin = (
  scheme: typeof skinPositions,
  rotations: Float32Array,
  at: number[],
  weights: { index: Uint8Array; weight: Float32Array },
) =>
  scheme(
    limb(),
    rotations,
    Float32Array.from(at),
    weights.index,
    weights.weight,
    new Float32Array(3),
  );

describe("dual quaternion skinning", () => {
  it("leaves a body at rest where it is", () => {
    const out = skin(skinPositionsDual, IDENTITY_POSE(2), [0.3, 0.7, -0.2], both(0.4));
    expect(Array.from(out)).toEqual([
      expect.closeTo(0.3, 6),
      expect.closeTo(0.7, 6),
      expect.closeTo(-0.2, 6),
    ]);
  });

  it("moves a vertex of one bone rigidly with it, as linear blending does", () => {
    const rotations = posing(1, turn(0, 0, 1, 70));
    const only = { index: Uint8Array.from([1, 0, 0, 0]), weight: Float32Array.from([1, 0, 0, 0]) };
    const dual = skin(skinPositionsDual, rotations, [0.5, 1.5, 0.25], only);
    const linear = skin(skinPositions, rotations, [0.5, 1.5, 0.25], only);
    for (let k = 0; k < 3; k++) expect(dual[k]).toBeCloseTo(linear[k] as number, 6);
  });

  it("agrees with linear blending when the bones it follows turn alike", () => {
    const q = turn(0.3, 0.5, 0.8, 55);
    const both2 = IDENTITY_POSE(2);
    both2.set(q, 0);
    // b inherits a's turn and adds none, so both bones carry the same rotation.
    const dual = skin(skinPositionsDual, both2, [0.4, 0.9, 0.1], both(0.5));
    const linear = skin(skinPositions, both2, [0.4, 0.9, 0.1], both(0.5));
    for (let k = 0; k < 3; k++) expect(dual[k]).toBeCloseTo(linear[k] as number, 6);
  });

  it("keeps a limb's radius through a twist where linear blending collapses it to the axis", () => {
    // A ring vertex at the joint, half on each bone, with the child turned 180° about the limb.
    const rotations = posing(1, turn(0, 1, 0, 180));
    const radius = (p: Float32Array) => Math.hypot(p[0] as number, p[2] as number);
    const ring = [1, 1, 0];
    expect(radius(skin(skinPositions, rotations, ring, both(0.5)))).toBeLessThan(1e-5);
    expect(radius(skin(skinPositionsDual, rotations, ring, both(0.5)))).toBeCloseTo(1, 5);
  });

  it("keeps a bent joint's surface at its radius where linear blending pinches it", () => {
    // 90° about z at the joint (0, 1, 0); the vertex sits 1 off the joint, half on each bone.
    const rotations = posing(1, turn(0, 0, 1, 90));
    const distance = (p: Float32Array) =>
      Math.hypot(p[0] as number, (p[1] as number) - 1, p[2] as number);
    const side = [1, 1, 0];
    expect(distance(skin(skinPositions, rotations, side, both(0.5)))).toBeCloseTo(Math.SQRT1_2, 5);
    expect(distance(skin(skinPositionsDual, rotations, side, both(0.5)))).toBeCloseTo(1, 5);
  });

  it("blends toward the nearer rotation whichever sign a quaternion is written with", () => {
    // q and -q are one rotation; flipping a bone's sign must not change the result.
    const q = turn(0, 0, 1, 90);
    const flipped = q.map((v) => -v);
    const a = skin(skinPositionsDual, posing(1, q), [1, 1, 0], both(0.5));
    const b = skin(skinPositionsDual, posing(1, flipped), [1, 1, 0], both(0.5));
    for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k] as number, 6);
  });

  it("turns a normal by the blended rotation", () => {
    const rotations = posing(1, turn(0, 1, 0, 180));
    const n = skinNormalsDual(
      limb(),
      rotations,
      Float32Array.from([1, 0, 0]),
      both(0.5).index,
      both(0.5).weight,
      new Float32Array(3),
    );
    // Half of 180° about y turns +x to -z, and a normal stays unit length.
    expect(n[0]).toBeCloseTo(0, 5);
    expect(n[2]).toBeCloseTo(-1, 5);
    expect(Math.hypot(...Array.from(n))).toBeCloseTo(1, 6);
  });
});

describe("dual quaternion skinning of bones that turn about different points", () => {
  it("moves a vertex halfway along the screw motion between its two bones", () => {
    // The root turns about the x axis at the origin, its child about y at (0, 1, 0): relative to
    // each other they turn and slide along a screw. Half-and-half is that screw's midpoint.
    const rotations = IDENTITY_POSE(2);
    rotations.set(turn(1, 0, 0, 70), 0);
    rotations.set(turn(0, 1, 0, 80), 4);
    const p = [0.4, 1.3, -0.2];
    const got = skin(skinPositionsDual, rotations, p, both(0.5));

    const { world, heads } = posedBones(limb(), rotations);
    const rot = (q: number[], v: number[]) =>
      rotate(q as Quat, v[0] as number, v[1] as number, v[2] as number);
    const sub = (a: number[], b: number[]) => a.map((x, i) => x - (b[i] as number));
    const add = (a: number[], b: number[]) => a.map((x, i) => x + (b[i] as number));
    const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] as number), 0);
    const cross = (a: number[], b: number[]) => [
      (a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number),
      (a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number),
      (a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number),
    ];
    const scale = (a: number[], s: number) => a.map((x) => x * s);
    // Each bone's motion x -> R x + t, with R from its world rotation and t from where its head goes.
    const qa = Array.from(world.subarray(0, 4));
    const qb = Array.from(world.subarray(4, 8));
    const motion = (q: number[], b: number) => ({
      q,
      t: sub(
        Array.from(heads.subarray(b * 3, b * 3 + 3)),
        rot(q, Array.from(limb().heads.subarray(b * 3, b * 3 + 3))),
      ),
    });
    const a = motion(qa, 0);
    const b = motion(qb, 1);
    // Relative motion A⁻¹B = x -> Rr x + tr, with q_r = qa* qb.
    const conj = (q: number[]) => [
      -(q[0] as number),
      -(q[1] as number),
      -(q[2] as number),
      q[3] as number,
    ];
    const qr = Array.from(mul(conj(qa) as Quat, qb as Quat));
    const tr = rot(conj(qa), sub(b.t, a.t));
    // Its screw: axis n, angle θ, slide along n and a perpendicular part about a point c.
    const sinHalf = Math.hypot(qr[0] as number, qr[1] as number, qr[2] as number);
    const n = scale(qr.slice(0, 3), 1 / sinHalf);
    const half = Math.atan2(sinHalf, qr[3] as number); // θ / 2
    const slide = dot(tr, n);
    const perp = sub(tr, scale(n, slide));
    const c = scale(add(perp, scale(cross(n, perp), 1 / Math.tan(half))), 0.5);
    // Half the screw: turn θ / 2 about c's axis, slide half as far.
    const qh = [...scale(n, Math.sin(half / 2)), Math.cos(half / 2)];
    const mid = add(add(rot(qh, sub(p, c)), c), scale(n, slide / 2));
    const want = add(rot(qa, mid), a.t);

    for (let k = 0; k < 3; k++) expect(got[k], `axis ${k}`).toBeCloseTo(want[k] as number, 5);
  });
});

describe("blended skinning", () => {
  const rotations = posing(1, turn(0, 0, 1, 90));
  const at = [1, 1, 0];
  const blendOf = (alpha: number[], rot = rotations) =>
    skinPositionsBlended(
      limb(),
      rot,
      Float32Array.from(at),
      both(0.5).index,
      both(0.5).weight,
      new Float32Array(3),
      Float32Array.from(alpha),
    );

  it("is linear blend skinning where no bone asks for dual quaternions, and dual where all do", () => {
    const linear = skin(skinPositions, rotations, at, both(0.5));
    const dual = skin(skinPositionsDual, rotations, at, both(0.5));
    for (let k = 0; k < 3; k++) {
      expect(blendOf([0, 0])[k]).toBeCloseTo(linear[k] as number, 6);
      expect(blendOf([1, 1])[k]).toBeCloseTo(dual[k] as number, 6);
    }
  });

  it("takes each vertex's share from the bones that weigh on it", () => {
    const linear = skin(skinPositions, rotations, at, both(0.5));
    const dual = skin(skinPositionsDual, rotations, at, both(0.5));
    // Half the weight on a bone that asks for dual, half on one that does not: halfway.
    const half = blendOf([1, 0]);
    for (let k = 0; k < 3; k++)
      expect(half[k]).toBeCloseTo(((linear[k] as number) + (dual[k] as number)) / 2, 6);
    // And a vertex that follows only the bone that does not ask stays linear.
    const only = skinPositionsBlended(
      limb(),
      rotations,
      Float32Array.from(at),
      Uint8Array.from([1, 0, 0, 0]),
      Float32Array.from([1, 0, 0, 0]),
      new Float32Array(3),
      Float32Array.from([1, 0]),
    );
    const rigid = skin(skinPositions, rotations, at, {
      index: Uint8Array.from([1, 0, 0, 0]),
      weight: Float32Array.from([1, 0, 0, 0]),
    });
    for (let k = 0; k < 3; k++) expect(only[k]).toBeCloseTo(rigid[k] as number, 6);
  });

  it("mixes the normal as the shader does: the linear sum, short where bones disagree, with the dual one", () => {
    const rotations = posing(1, turn(0, 1, 0, 100));
    const normal = Float32Array.from([1, 0, 0]);
    const share = 0.4;
    const { world } = posedBones(limb(), rotations);
    const turned = (b: number) =>
      rotate(Array.from(world.subarray(b * 4, b * 4 + 4)) as Quat, 1, 0, 0);
    // Half on each bone: the linear normal is their mean, shorter than a unit; the dual one is a unit.
    const linear = [0, 1, 2].map(
      (k) => 0.5 * (turned(0)[k] as number) + 0.5 * (turned(1)[k] as number),
    );
    const dual = skinNormalsDual(
      limb(),
      rotations,
      normal,
      both(0.5).index,
      both(0.5).weight,
      new Float32Array(3),
    );
    expect(Math.hypot(...linear)).toBeLessThan(0.7);
    const mix = linear.map((x, k) => (1 - share) * x + share * (dual[k] as number));
    const len = Math.hypot(...mix);
    const got = skinNormalsBlended(
      limb(),
      rotations,
      normal,
      both(0.5).index,
      both(0.5).weight,
      new Float32Array(3),
      share,
    );
    for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo((mix[k] as number) / len, 6);
  });

  it("blends normals the same way, and keeps them unit length", () => {
    const normals = Float32Array.from([1, 0, 0]);
    const n = skinNormalsBlended(
      limb(),
      posing(1, turn(0, 1, 0, 180)),
      normals,
      both(0.5).index,
      both(0.5).weight,
      new Float32Array(3),
      Float32Array.from([1, 1]),
    );
    expect(n[2]).toBeCloseTo(-1, 5);
    const half = skinNormalsBlended(
      limb(),
      posing(1, turn(0, 0, 1, 90)),
      normals,
      both(0.5).index,
      both(0.5).weight,
      new Float32Array(3),
      Float32Array.from([0.5, 0.5]),
    );
    expect(Math.hypot(...Array.from(half))).toBeCloseTo(1, 6);
  });
});

describe("dualBoneTexels", () => {
  it("lays out each bone as its dual quaternion and its share, for the renderer's bone texture", () => {
    const rotations = posing(1, turn(0, 0, 1, 40));
    const dual = dualBones(limb(), rotations);
    const texels = dualBoneTexels(limb(), rotations, [0.25, 0.75]);
    expect(texels.length).toBe(2 * DUAL_TEXELS * 4);
    for (let b = 0; b < 2; b++) {
      const at = b * DUAL_TEXELS * 4;
      expect(Array.from(texels.subarray(at, at + 8))).toEqual(
        Array.from(dual.subarray(b * 8, b * 8 + 8)),
      );
      expect(Array.from(texels.subarray(at + 8, at + 12))).toEqual([
        b === 0 ? 0.25 : 0.75,
        0,
        0,
        0,
      ]);
    }
    expect(dualBoneTexels(limb(), rotations, 1)[8]).toBe(1);
  });
});

describe("dualBones", () => {
  it("gives each bone a unit rotation and a translation, orthogonal as a rigid motion must be", () => {
    const d = dualBones(limb(), posing(1, turn(0.2, 0.9, 0.4, 100)));
    for (let b = 0; b < 2; b++) {
      const [qx, qy, qz, qw, dx, dy, dz, dw] = Array.from(d.subarray(b * 8, b * 8 + 8)) as number[];
      expect(Math.hypot(qx as number, qy as number, qz as number, qw as number)).toBeCloseTo(1, 6);
      expect(
        (qx as number) * (dx as number) +
          (qy as number) * (dy as number) +
          (qz as number) * (dz as number) +
          (qw as number) * (dw as number),
      ).toBeCloseTo(0, 6);
    }
  });

  it("moves a bone's head to where the pose puts it", () => {
    // Turn a 90° about z: b's head (0, 1, 0) goes to (-1, 0, 0).
    const d = dualBones(limb(), posing(0, turn(0, 0, 1, 90)));
    const out = skin(skinPositionsDual, posing(0, turn(0, 0, 1, 90)), [0, 1, 0], {
      index: Uint8Array.from([1, 0, 0, 0]),
      weight: Float32Array.from([1, 0, 0, 0]),
    });
    expect(out[0]).toBeCloseTo(-1, 6);
    expect(out[1]).toBeCloseTo(0, 6);
    expect(d.length).toBe(16);
  });
});
