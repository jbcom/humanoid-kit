/**
 * What the animation tests share: the packed clips read from the pack on disk,
 * figures of three body types at three ages, and a measure of how far a planted
 * foot moves while it is on the ground.
 */
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { Animator } from "../src/animation/animator.ts";
import { type BodySegment, bodySegments } from "../src/animation/clearance.ts";
import {
  type AnimationClip,
  type AnimationManifest,
  type ClipEntry,
  parseClip,
} from "../src/animation/clip.ts";
import { contactBones, contactPoints } from "../src/animation/locomotion.ts";
import { groupFaces } from "../src/format/assetFormat.ts";
import type { MacroValues } from "../src/makehuman/macro.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import type { RestBones } from "../src/rig/bones.ts";
import { restBones, rigData } from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

export const PACK = path.resolve(import.meta.dirname, "../packs/animations/data");
export const assets = loadFixtureAssets();
export const rig = rigData(assets);
export const manifest = JSON.parse(
  fs.readFileSync(path.join(PACK, "manifest.json"), "utf8"),
) as AnimationManifest;

export const entry = (id: string): ClipEntry => {
  const e = manifest.clips.find((c) => c.id === id);
  if (!e) throw new Error(`no clip ${id}`);
  return e;
};

/** The packed binary of a clip, gunzipped. */
export function clipBinary(e: ClipEntry): ArrayBuffer {
  const b = gunzipSync(fs.readFileSync(path.join(PACK, e.file)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

const clips = new Map<string, AnimationClip>();
export function clip(id: string): AnimationClip {
  let c = clips.get(id);
  if (!c) {
    const e = entry(id);
    c = parseClip(e, rig.bones, clipBinary(e));
    clips.set(id, c);
  }
  return c;
}

/** Three body types, each at three ages: slim and female, average, heavy and muscular and male. */
export const BODY_TYPES: readonly [string, Partial<MacroValues>][] = [
  ["slim", { gender: 1, weight: 0.1 }],
  ["average", { gender: 0.5 }],
  ["heavy", { gender: 0, weight: 0.95, muscle: 0.8 }],
];
export const AGES = [6, 25, 75] as const;

const model = new HumanoidModel(assets, { subdivision: 0 });
/** The base vertices of the visible body (helper geometry left out). */
const bodyVertices = (() => {
  const out = new Set<number>();
  for (const q of groupFaces(assets, "body"))
    for (let k = 0; k < 4; k++) out.add(assets.faceVerts[q * 4 + k] as number);
  return Array.from(out);
})();

export interface Figure {
  name: string;
  rest: RestBones;
  /** The body's capsules, measured from the figure's own skin (`bodySegments`). */
  segments: BodySegment[];
  /** Height of the ground under the figure at rest (its lowest point's). */
  ground: number;
}

const figures = new Map<string, Figure>();
export function figure(type: string, age: number): Figure {
  const key = `${type}@${age}`;
  let f = figures.get(key);
  if (!f) {
    const macros = BODY_TYPES.find(([n]) => n === type)?.[1];
    if (!macros) throw new Error(`no body type ${type}`);
    const ev = model.evaluate(createRecipe({ macros: { age, ...macros } }));
    let ground = Number.POSITIVE_INFINITY;
    for (let i = 1; i < ev.control.length; i += 3)
      ground = Math.min(ground, ev.control[i] as number);
    const rest = restBones(assets, ev.control);
    f = {
      name: key,
      rest,
      segments: bodySegments(
        assets,
        rest,
        ev.control,
        assets.skinIndex,
        assets.skinWeight,
        bodyVertices,
      ),
      ground,
    };
    figures.set(key, f);
  }
  return f;
}

export function allFigures(): Figure[] {
  return BODY_TYPES.flatMap(([type]) => AGES.map((age) => figure(type, age)));
}

/**
 * The longest a foot's planted part moves while it is on the ground: a clip played
 * on `fig` for `cycles` cycles at 60 Hz, and for each of the four planted parts
 * (a heel, and the ball's two toe joints' mean, per foot) every stretch of at
 * least four frames (67 ms) that its height above the lowest of the six contact
 * points stays under 2 mm, its largest distance from where the stretch began.
 * The first cycle is skipped, as the feet land in their places.
 */
export function stanceDrift(
  fig: Figure,
  c: AnimationClip,
  cycles = 4,
): { worst: number; stances: number } {
  const an = new Animator(rig.bones.length, fig.rest, fig.ground);
  an.play(c);
  const bones = contactBones(fig.rest);
  const buf = new Float32Array(bones.length * 3);
  const groups = [[0], [1, 2], [3], [4, 5]];
  const dt = 1 / 60;
  const frames = Math.round((cycles * c.duration) / dt);
  const pos: number[][] = [];
  const height: number[][] = [];
  for (let i = 0; i < frames; i++) {
    an.update(dt);
    contactPoints(fig.rest, an.rotations, fig.ground, buf, 0, bones);
    let low = Number.POSITIVE_INFINITY;
    for (let k = 0; k < bones.length; k++) low = Math.min(low, buf[k * 3 + 1] as number);
    const mean = (g: number[], axis: number) =>
      g.reduce((s, k) => s + (buf[k * 3 + axis] as number), 0) / g.length;
    pos.push(groups.flatMap((g) => [mean(g, 0) + an.root[0], mean(g, 2) + an.root[1]]));
    height.push(groups.map((g) => mean(g, 1) - low));
  }
  let worst = 0;
  let stances = 0;
  groups.forEach((_, g) => {
    let start = -1;
    for (let i = Math.round(c.duration / dt); i <= frames; i++) {
      const planted = i < frames && (height[i]?.[g] as number) < 0.002;
      if (planted && start < 0) start = i;
      if (!planted && start >= 0) {
        if (i - start >= 4) {
          stances++;
          for (let a = start; a < i; a++)
            worst = Math.max(
              worst,
              Math.hypot(
                (pos[a]?.[g * 2] as number) - (pos[start]?.[g * 2] as number),
                (pos[a]?.[g * 2 + 1] as number) - (pos[start]?.[g * 2 + 1] as number),
              ),
            );
        }
        start = -1;
      }
    }
  });
  return { worst, stances };
}
