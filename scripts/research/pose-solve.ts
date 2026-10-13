/**
 * Solves an authored key pose's channels so named joints land where they are
 * wanted: the hands on a musket's stock and barrel, a hand at the mouth, a foot
 * planted behind. An aid for writing `scripts/clips/` and `scripts/poses/`, whose
 * files stay plain channel values; the packer never runs this.
 *
 *   node scripts/research/pose-solve.ts <problem.json> [--figure average@25]
 *
 * The problem file:
 *
 *   {
 *     "base": "tpose",
 *     "rotations": { "spine03": { "Xrotation": 10 } },        // held as given
 *     "vary": ["upperarm01.R/Xrotation", "lowerarm01.R/Xrotation"],
 *     "targets": [
 *       { "bone": "wrist.R", "at": [-0.2, 1.1, 0.25] },        // figure frame, metres
 *       { "bone": "wrist.L", "to": "head", "offset": [0, -0.1, 0.12] }, // from a joint
 *       { "bone": "wrist.L", "toward": "wrist.R", "distance": 0.45 }    // apart by
 *     ]
 *   }
 *
 * The figure's frame is metres with +x the figure's left, +y up and +z
 * forward, the rest pose's lowest joint on y = 0 (the hips do not move, so a
 * kneel's joints go below it). A varied channel starts at its
 * `rotations` value (zero if absent) and is pulled gently back toward it, so
 * the solve stays near the pose it was given and settles a redundant chain.
 * It prints the merged rotations, ready to paste, and each target's miss.
 */
import fs from "node:fs";
import type { MacroValues } from "../../src/makehuman/macro.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { posedBoneHeads } from "../../src/rig/bones.ts";
import { frameRotations, IDENTITY_POSE, restBones, rigData } from "../../src/rig/pose.ts";
import { loadFixtureAssets } from "../../tests/fixtures.ts";
import { poseFrame } from "../lib/authoredPoses.ts";

type Vec = [number, number, number];
type Target =
  | { bone: string; at: Vec }
  | { bone: string; to: string; offset?: Vec }
  | { bone: string; toward: string; distance: number };
interface Problem {
  base: string;
  rotations?: Record<string, Record<string, number>>;
  vary: string[];
  targets: Target[];
  /** Weight of the pull back toward the given values, per radian squared. */
  stiffness?: number;
}

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1] ?? fallback;
  args.splice(i, 2);
  return v;
};
const [type = "average", age = "25"] = option("figure", "average@25").split("@");
const [file] = args;
if (!file) throw new Error("usage: pose-solve.ts <problem.json>");
const problem = JSON.parse(fs.readFileSync(file, "utf8")) as Problem;

const TYPES: Record<string, Partial<MacroValues>> = {
  slim: { gender: 1, weight: 0.1 },
  average: { gender: 0.5 },
  heavy: { gender: 0, weight: 0.95, muscle: 0.8 },
};
const assets = loadFixtureAssets();
const rig = rigData(assets);
const base = rig.poses.find((p) => p.name === problem.base);
if (!base) throw new Error(`no base pose ${problem.base}`);
const ev = new HumanoidModel(assets, { subdivision: 0 }).evaluate(
  createRecipe({ macros: { age: Number(age), ...TYPES[type] } }),
);
const rest = restBones(assets, ev.control);
const bone = (name: string) => {
  const i = rig.bones.indexOf(name);
  if (i < 0) throw new Error(`no bone ${name}`);
  return i;
};

const fixed = new Map<string, number>();
for (const [joint, channels] of Object.entries(problem.rotations ?? {}))
  for (const [c, v] of Object.entries(channels)) fixed.set(`${joint}/${c}`, v);
for (const key of problem.vary) {
  const [joint = "", channel = ""] = key.split("/");
  const j = base.joints.find((b) => b.name === joint);
  if (!j?.channels.includes(channel)) throw new Error(`${problem.base} has no channel ${key}`);
}
const start = problem.vary.map((k) => fixed.get(k) ?? 0);
const stiffness = problem.stiffness ?? 0.002;

// The rig's frame has its origin at the hips; lift it so the rest pose's lowest
// joint (a toe) stands on y = 0, the same for every solve.
const restHeads = posedBoneHeads(rest, IDENTITY_POSE(rig.bones.length));
let ground = Number.POSITIVE_INFINITY;
for (let b = 0; b < rig.bones.length; b++)
  ground = Math.min(ground, restHeads[b * 3 + 1] as number);

const heads = (x: readonly number[]): Float32Array => {
  const values = new Map(fixed);
  for (const [i, k] of problem.vary.entries()) values.set(k, x[i] as number);
  const rotations = IDENTITY_POSE(rig.bones.length);
  for (const [b, q] of frameRotations(rig, base.joints, poseFrame(base, values)))
    rotations.set(q, b * 4);
  const h = posedBoneHeads(rest, rotations);
  for (let b = 0; b < rig.bones.length; b++) h[b * 3 + 1] = (h[b * 3 + 1] as number) - ground;
  return h;
};
const at = (h: Float32Array, name: string): Vec => {
  const b = bone(name);
  return [h[b * 3] as number, h[b * 3 + 1] as number, h[b * 3 + 2] as number];
};

/** Each target's miss as residual components, then the pull toward the start. */
const residuals = (x: readonly number[]): number[] => {
  const h = heads(x);
  const r: number[] = [];
  for (const t of problem.targets) {
    const p = at(h, t.bone);
    if ("at" in t) r.push(p[0] - t.at[0], p[1] - t.at[1], p[2] - t.at[2]);
    else if ("to" in t) {
      const q = at(h, t.to);
      const o = t.offset ?? [0, 0, 0];
      r.push(p[0] - q[0] - o[0], p[1] - q[1] - o[1], p[2] - q[2] - o[2]);
    } else {
      const q = at(h, t.toward);
      r.push(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) - t.distance);
    }
  }
  const w = Math.sqrt(stiffness);
  for (const [i, v] of x.entries()) r.push((w * (v - (start[i] as number)) * Math.PI) / 180);
  return r;
};
const cost = (r: readonly number[]) => r.reduce((s, v) => s + v * v, 0);

// Levenberg–Marquardt over the varied channels, with a numeric Jacobian.
let x = [...start];
let r = residuals(x);
let lambda = 1e-3;
for (let iter = 0; iter < 400; iter++) {
  const n = x.length;
  const m = r.length;
  const J: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    const step = 0.01;
    const xp = [...x];
    xp[i] = (xp[i] as number) + step;
    const rp = residuals(xp);
    for (let k = 0; k < m; k++)
      (J[k] as number[])[i] = ((rp[k] as number) - (r[k] as number)) / step;
  }
  const A: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      J.reduce((s, row) => s + (row[i] as number) * (row[j] as number), 0),
    ),
  );
  const g = Array.from({ length: n }, (_, i) =>
    J.reduce((s, row, k) => s + (row[i] as number) * (r[k] as number), 0),
  );
  let improved = false;
  for (let tries = 0; tries < 12 && !improved; tries++) {
    const M = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
    const dx = solve(
      M,
      g.map((v) => -v),
    );
    const xn = x.map((v, i) => v + (dx[i] as number));
    const rn = residuals(xn);
    if (cost(rn) < cost(r)) {
      improved = Math.abs(cost(r) - cost(rn)) > 1e-14;
      x = xn;
      r = rn;
      lambda = Math.max(1e-7, lambda / 3);
    } else lambda *= 4;
  }
  if (!improved) break;
}

/** Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i] as number]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++)
      if (Math.abs((M[i] as number[])[c] as number) > Math.abs((M[p] as number[])[c] as number))
        p = i;
    [M[c], M[p]] = [M[p] as number[], M[c] as number[]];
    const pivot = (M[c] as number[])[c] as number;
    if (Math.abs(pivot) < 1e-15) continue;
    for (let i = 0; i < n; i++) {
      if (i === c) continue;
      const f = ((M[i] as number[])[c] as number) / pivot;
      for (let k = c; k <= n; k++)
        (M[i] as number[])[k] =
          ((M[i] as number[])[k] as number) - f * ((M[c] as number[])[k] as number);
    }
  }
  return M.map((row, i) => (row[n] as number) / ((row[i] as number) || 1));
}

const out: Record<string, Record<string, number>> = {};
const merged = new Map(fixed);
for (const [i, k] of problem.vary.entries()) merged.set(k, Math.round((x[i] as number) * 10) / 10);
for (const [key, v] of [...merged].sort()) {
  const [joint = "", channel = ""] = key.split("/");
  out[joint] ??= {};
  (out[joint] as Record<string, number>)[channel] = v;
}
console.log(JSON.stringify(out));
const h = heads(x);
const show = (name: string) =>
  `${name} (${at(h, name)
    .map((v) => v.toFixed(3))
    .join(",")})`;
for (const t of problem.targets) {
  const other = "to" in t ? t.to : "toward" in t ? t.toward : null;
  console.log(other ? `${show(t.bone)} from ${show(other)}` : show(t.bone));
}
const fit = r.slice(0, r.length - x.length);
console.log(`miss ${Math.sqrt(cost(fit)).toFixed(4)} m`);
