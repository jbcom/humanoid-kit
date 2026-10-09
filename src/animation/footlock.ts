/**
 * Planted feet stay planted: a foot that is on the ground holds its place in the
 * world while the figure is carried past it, by a two-bone leg solve.
 *
 * A clip authored on one skeleton, and root motion derived from another's feet
 * (`planRootMotion`), do not agree to the centimetre: a stance foot in a hand-keyed
 * walk speeds up and slows down against the body that carries it. Rather than
 * bend the root's path to follow, which jerks the body, the root moves smoothly
 * and the legs absorb the difference.
 *
 * Each foot pins one of its three contact points at a time (`CONTACT_BONES`: on
 * the sole under the ankle, and under the ball's two toe joints): the one on the
 * ground, which is the lowest of the six within `PLANT_FULL`. It pins where it is
 * in the world (horizontally; the clip keeps its height) and, while it stays on
 * the ground, the ankle is moved so the point is still on its pin, the hip and
 * knee turned to reach it and the foot's own orientation kept. The knee bends in
 * the plane it already bends in. As the foot rolls (heel, flat, toes) the pin
 * hands over to the point that is then the lowest, taking the place it has in the
 * already held foot, so the hand-over is seamless; a point that lifts past
 * `PLANT_NONE` is let go, the hold fading out as it rises.
 */
import { type BoneRotations, posedBones, type RestBones } from "../rig/bones.ts";
import { between, conjugate, mul, type Quat, rotate } from "../rig/quat.ts";
import { CONTACT_BONES, contactBones, contactPoints } from "./locomotion.ts";

/** A contact point's height above the lowest within which it lands: it pins where it is, metres. */
export const PLANT_LAND = 0.004;
/** ...and within which it is held fully. */
export const PLANT_FULL = 0.002;
/** ...and from which a held point is let go. */
export const PLANT_NONE = 0.008;
/** How much lower than the pinned point another of the foot's points must be before the pin hands over to it, metres. */
export const PLANT_SWITCH = 0.0015;

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

interface Leg {
  upper: number;
  lower: number;
  foot: number;
  /** Indices (into `CONTACT_BONES`) of this foot's three contact points. */
  points: [number, number, number];
}

const quatAt = (a: ArrayLike<number>, i: number): Quat => [
  a[i * 4] as number,
  a[i * 4 + 1] as number,
  a[i * 4 + 2] as number,
  a[i * 4 + 3] as number,
];

export class FootLock {
  private readonly legs: Leg[];
  private readonly bones: Int16Array;
  private readonly buf = new Float32Array(CONTACT_BONES.length * 3);
  private readonly rest: RestBones;
  private readonly ground: number;
  /** Per foot, the contact point index pinned (-1: none) and where, in the world (x, z). */
  private readonly pinned = new Int8Array(2).fill(-1);
  private readonly pin = new Float64Array(4);

  constructor(rest: RestBones, ground: number) {
    this.rest = rest;
    this.ground = ground;
    this.bones = contactBones(rest);
    const at = (name: string) => {
      const i = rest.names.indexOf(name);
      if (i < 0) throw new Error(`the rig has no bone ${name}`);
      return i;
    };
    this.legs = (["L", "R"] as const).map((side, s) => ({
      upper: at(`upperleg01.${side}`),
      lower: at(`lowerleg01.${side}`),
      foot: at(`foot.${side}`),
      points: [s * 3, s * 3 + 1, s * 3 + 2],
    }));
  }

  /** Forgets every pin: call when the figure is moved by hand, or its root reset. */
  reset(): void {
    this.pinned.fill(-1);
  }

  /**
   * Turns the legs of `rotations` (in place) so that the contact points on the
   * ground are where they were pinned. `root` is how far the figure has been
   * carried (x, z), which the pins are in the frame of.
   */
  apply(rotations: BoneRotations, root: readonly [number, number]): void {
    const { rest, buf } = this;
    contactPoints(rest, rotations, this.ground, buf, 0, this.bones);
    let low = Number.POSITIVE_INFINITY;
    for (let k = 0; k < CONTACT_BONES.length; k++) low = Math.min(low, buf[k * 3 + 1] as number);
    const { world, heads } = posedBones(rest, rotations);
    this.legs.forEach((leg, s) => {
      const rel = (k: number) => (buf[k * 3 + 1] as number) - low;
      const ankle = [
        heads[leg.foot * 3] as number,
        heads[leg.foot * 3 + 1] as number,
        heads[leg.foot * 3 + 2] as number,
      ] as const;
      let cand = leg.points[0];
      for (const k of leg.points) if (rel(k) < rel(cand)) cand = k;
      let pinned = this.pinned[s] as number;
      // Where the held ankle goes, if a point is pinned (and by how much).
      let target: [number, number] | null = null;
      let hold = 0;
      const ankleFor = (k: number): [number, number] => [
        (this.pin[s * 2] as number) - root[0] - ((buf[k * 3] as number) - ankle[0]),
        (this.pin[s * 2 + 1] as number) - root[1] - ((buf[k * 3 + 2] as number) - ankle[2]),
      ];
      if (pinned >= 0) {
        if (rel(pinned) >= PLANT_NONE) {
          pinned = -1;
        } else {
          hold = 1 - smoothstep(PLANT_FULL, PLANT_NONE, rel(pinned));
          target = ankleFor(pinned);
          if (cand !== pinned && rel(cand) < rel(pinned) - PLANT_SWITCH) {
            // The foot rolls: the lower point takes over, at the place it has in the foot as it is held.
            const dx = target[0] - ankle[0];
            const dz = target[1] - ankle[2];
            this.pin[s * 2] = (buf[cand * 3] as number) + dx + root[0];
            this.pin[s * 2 + 1] = (buf[cand * 3 + 2] as number) + dz + root[1];
            pinned = cand;
            target = ankleFor(pinned);
          }
        }
      }
      if (pinned < 0 && rel(cand) < PLANT_LAND) {
        // A point that has just landed pins where it is.
        pinned = cand;
        this.pin[s * 2] = (buf[cand * 3] as number) + root[0];
        this.pin[s * 2 + 1] = (buf[cand * 3 + 2] as number) + root[1];
        target = ankleFor(pinned);
        hold = 1 - smoothstep(PLANT_FULL, PLANT_NONE, rel(pinned));
      }
      this.pinned[s] = pinned;
      if (target === null || hold <= 0) return;
      const gx = ankle[0] + hold * (target[0] - ankle[0]);
      const gz = ankle[2] + hold * (target[1] - ankle[2]);
      this.solve(leg, rotations, world, heads, [gx, ankle[1], gz]);
    });
  }

  /** Two-bone solve: the leg's hip and knee turned so the ankle reaches `target`, the foot's world orientation kept. */
  private solve(
    leg: Leg,
    rotations: BoneRotations,
    world: Float32Array,
    heads: Float32Array,
    target: readonly [number, number, number],
  ): void {
    const { rest } = this;
    const hip: [number, number, number] = [
      heads[leg.upper * 3] as number,
      heads[leg.upper * 3 + 1] as number,
      heads[leg.upper * 3 + 2] as number,
    ];
    const knee: [number, number, number] = [
      heads[leg.lower * 3] as number,
      heads[leg.lower * 3 + 1] as number,
      heads[leg.lower * 3 + 2] as number,
    ];
    const ankle: [number, number, number] = [
      heads[leg.foot * 3] as number,
      heads[leg.foot * 3 + 1] as number,
      heads[leg.foot * 3 + 2] as number,
    ];
    const len1 = Math.hypot(knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]);
    const len2 = Math.hypot(ankle[0] - knee[0], ankle[1] - knee[1], ankle[2] - knee[2]);
    let dx = target[0] - hip[0];
    let dy = target[1] - hip[1];
    let dz = target[2] - hip[2];
    // Within what the leg can reach (never quite straight, never folded back on itself),
    // keeping the ankle's height: a target out of reach is met as near as the ground
    // plane allows, not by lifting the foot off the ground.
    const far = len1 + len2 - 1e-4;
    const near = Math.abs(len1 - len2) + 1e-4;
    const flat = Math.hypot(dx, dz);
    const wanted = Math.hypot(flat, dy);
    if (wanted > far || wanted < near) {
      const radius = Math.sqrt(Math.max(0, (wanted > far ? far : near) ** 2 - dy * dy));
      const k = flat > 1e-9 ? radius / flat : 0;
      dx *= k;
      dz *= k;
    }
    let d = Math.hypot(dx, dy, dz);
    if (d < 1e-9) return;
    dx /= d;
    dy /= d;
    dz /= d;
    d = Math.min(far, Math.max(near, d));
    // The knee stays in the plane it bends in: its offset from the hip-to-ankle line, kept in direction.
    const kx = knee[0] - hip[0];
    const ky = knee[1] - hip[1];
    const kz = knee[2] - hip[2];
    const along = kx * dx + ky * dy + kz * dz;
    let nx = kx - along * dx;
    let ny = ky - along * dy;
    let nz = kz - along * dz;
    let nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-6) {
      // A straight leg: bend toward the front, the way a knee does.
      nx = -dx * dz;
      ny = -dy * dz;
      nz = 1 - dz * dz;
      nl = Math.hypot(nx, ny, nz) || 1;
    }
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const a = (len1 * len1 - len2 * len2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, len1 * len1 - a * a));
    const newKnee: [number, number, number] = [
      hip[0] + a * dx + h * nx,
      hip[1] + a * dy + h * ny,
      hip[2] + a * dz + h * nz,
    ];
    const newTarget: [number, number, number] = [hip[0] + d * dx, hip[1] + d * dy, hip[2] + d * dz];
    // The hip turns the thigh to the new knee; the ankle goes with it.
    const turn1 = between(
      [knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]],
      [newKnee[0] - hip[0], newKnee[1] - hip[1], newKnee[2] - hip[2]],
    );
    const ankle1 = rotate(turn1, ankle[0] - hip[0], ankle[1] - hip[1], ankle[2] - hip[2]);
    const shin1: [number, number, number] = [
      hip[0] + ankle1[0] - newKnee[0],
      hip[1] + ankle1[1] - newKnee[1],
      hip[2] + ankle1[2] - newKnee[2],
    ];
    // The knee turns the shin to the target.
    const turn2 = between(shin1, [
      newTarget[0] - newKnee[0],
      newTarget[1] - newKnee[1],
      newTarget[2] - newKnee[2],
    ]);
    const parentOf = (b: number) => rest.parents[b] as number;
    const write = (b: number, local: Quat) => rotations.set(local, b * 4);
    // Hip: its world rotation turned by turn1; local = parent⁻¹ · world.
    const upperWorld = mul(turn1, quatAt(world, leg.upper));
    write(leg.upper, mul(conjugate(quatAt(world, parentOf(leg.upper))), upperWorld));
    // Knee: its parent (the thigh's twist bone) turns with turn1, and the knee itself by turn2 · turn1.
    const both = mul(turn2, turn1);
    write(
      leg.lower,
      mul(
        conjugate(mul(turn1, quatAt(world, parentOf(leg.lower)))),
        mul(both, quatAt(world, leg.lower)),
      ),
    );
    // Foot: kept at its own world orientation under a parent that now turns by `both`.
    write(
      leg.foot,
      mul(conjugate(mul(both, quatAt(world, parentOf(leg.foot)))), quatAt(world, leg.foot)),
    );
  }
}
