/**
 * The affordance handle on a live figure (src/affordance/live.ts,
 * docs/ARCHITECTURE.md, "Affordances: the registry", "The public API"): frames
 * worked out when read, from the inputs the GPU draws with (an evaluation's
 * rest surface, the skin weights, the pose, the hip fold at its fade, the
 * lifted group's transform), and the figure's own affordances by its age.
 *
 * Fed what the posed body on the CPU is made from, the handle frames every
 * affordance as `affordanceFrames` does on that body; that the frames are the
 * GPU's is tests/browser/affordanceGpu.test.tsx's.
 */
import { Group, Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { affordanceChannels, affordanceFrames } from "../src/affordance/frames.ts";
import { HumanoidAffordances, type LiveFigure } from "../src/affordance/live.ts";
import { affordances, CORE_AFFORDANCES } from "../src/affordance/registry.ts";
import { AffordanceStates } from "../src/affordance/state.ts";
import { batteryBody } from "../src/foundation/battery.ts";
import { frameOut, LANDMARK_IDS, landmarkAnchors, landmarks } from "../src/foundation/landmarks.ts";
import { REST_POSE, SMOKE_POSES } from "../src/foundation/permutations.ts";
import { posedSurface } from "../src/foundation/posed.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe, type Recipe } from "../src/recipe/recipe.ts";
import { skinFold, skinPose } from "../src/rig/dual.ts";
import { renderFold } from "../src/rig/hipFold.ts";
import {
  bodyPoseRotations,
  IDENTITY_POSE,
  posedBones,
  restBones,
  rigData,
} from "../src/rig/pose.ts";
import { poseShare, skinDualShare } from "../src/rig/skinShare.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
const anchors = { base: landmarkAnchors(model, "base"), adult: null };

/** The recipe's hip fold on its body surface, solved to the end. */
function solvedFold(recipe: Recipe) {
  const steps = model.hipFold(recipe);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value.fold;
}

/** A figure as `<Humanoid>` feeds the handle one: an evaluation, posed, with its fold whole. */
function liveFigure(recipe: Recipe, pose: string, world: Group | null = null): LiveFigure {
  const ev = model.evaluate(recipe);
  const rest = Float32Array.from(ev.positions);
  const restNormals = Float32Array.from(ev.normals);
  const bones = restBones(model.assets, Float32Array.from(ev.control));
  const rig = rigData(model.assets);
  const rotations =
    pose === REST_POSE ? IDENTITY_POSE(rig.bones.length) : bodyPoseRotations(rig, pose);
  const skin = skinPose(bones, rotations, poseShare(bones, rotations, skinDualShare(bones.names)));
  const fold = skinFold(bones, rotations, renderFold(solvedFold(recipe)), 1);
  const skeleton = posedBones(bones, rotations);
  const { skinIndex, skinWeight } = model.topology().body;
  return {
    surface: ev.surface,
    rest,
    restNormals,
    skinIndex,
    skinWeight,
    pose: () => skin,
    fold: () => fold,
    skeleton: () => skeleton,
    world,
  };
}

const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  );

describe("the affordance handle on a live figure", { timeout: 300_000 }, () => {
  it("frames every affordance as the posed body does, in every smoke pose (the seated one folded)", () => {
    for (const name of ["f-slim", "m-heavy"] as const) {
      const recipe = createRecipe({ macros: { ...batteryBody(name).macros } });
      for (const pose of SMOKE_POSES) {
        const h = new HumanoidAffordances();
        h.setRecipe(recipe);
        h.setAnchors(anchors);
        const figure = liveFigure(recipe, pose);
        if (pose === "seated") expect(figure.fold(), "the seated pose folds").not.toBeNull();
        h.attach(figure);
        const body = posedSurface(model, recipe, pose);
        const want = affordanceFrames(model, body, h.own);
        const out = frameOut();
        let worst = 0;
        for (const a of h.own) {
          const got = h.frame(a.id, "figure", out);
          expect(got, `${name} ${pose} ${a.id}`).toBe(out);
          const f = want[a.id];
          if (!got || !f) throw new Error(`${a.id}: no frame`);
          for (const k of ["position", "normal", "tangent", "bitangent"] as const)
            worst = Math.max(worst, distance(got[k], f[k]));
        }
        expect(worst, `${name} ${pose}`).toBeLessThan(1e-6);
        // So is every landmark, the fold's among them.
        const marks = landmarks(model, body);
        let worstMark = 0;
        for (const id of LANDMARK_IDS) {
          const got = h.landmark(id, "figure", out);
          if (!got) throw new Error(`${id}: no frame`);
          for (const k of ["position", "normal", "tangent", "bitangent"] as const)
            worstMark = Math.max(worstMark, distance(got[k], marks[id][k]));
        }
        expect(worstMark, `${name} ${pose} landmarks`).toBeLessThan(1e-6);
        if (pose === "seated") {
          // No landmark is on the skin the fold moves, but a vertex there is where the
          // posed body has it, and framed without the fold it would be elsewhere.
          const fold = figure.fold();
          if (!fold) throw new Error("no fold");
          const unfolded = new HumanoidAffordances();
          unfolded.setRecipe(recipe);
          unfolded.setAnchors(anchors);
          unfolded.attach({ ...figure, fold: () => null });
          let worstVertex = 0;
          let furthest = 0;
          for (const [v, row] of fold.fold.slot.entries()) {
            if (row < 0) continue;
            const got = h.vertex(v);
            const bare = unfolded.vertex(v);
            if (!got || !bare) throw new Error(`vertex ${v}: none`);
            worstVertex = Math.max(
              worstVertex,
              distance(got, Array.from(body.positions.subarray(v * 3, v * 3 + 3))),
            );
            furthest = Math.max(furthest, distance(got, bare));
          }
          expect(worstVertex, `${name} fold`).toBeLessThan(1e-6);
          expect(furthest, `${name} fold`).toBeGreaterThan(0.005);
        }
        // The channels, opened as the states say, are the posed body's too.
        h.set("mouth", { opening: 0.6 });
        const states = new AffordanceStates(h.own);
        states.set("mouth", { opening: 0.6 });
        const channels = affordanceChannels(model, body, h.own, states);
        for (const [id, c] of Object.entries(channels)) {
          const live = h.channel(id);
          if (!live) throw new Error(`${id}: no channel`);
          expect(distance(live.origin, c.origin), id).toBeLessThan(1e-6);
          expect(distance(live.inward, c.inward), id).toBeLessThan(1e-6);
          expect(live.knots.flat().map((x) => Number(x.toFixed(9)))).toEqual(
            c.knots.flat().map((x) => Number(x.toFixed(9))),
          );
        }
      }
    }
  });

  it("carries frames and places to world space by the lifted group's transform", () => {
    const recipe = createRecipe();
    const group = new Group();
    group.position.set(0.4, 0.05, -1.2);
    group.rotation.set(0.1, 0.8, -0.05);
    group.scale.setScalar(1.25);
    const parent = new Group();
    parent.position.set(0, 0.3, 0);
    parent.add(group);
    const h = new HumanoidAffordances();
    h.setRecipe(recipe);
    h.setAnchors(anchors);
    h.attach(liveFigure(recipe, "relaxed", group));
    group.updateWorldMatrix(true, false);
    const toWorld = new Matrix4().copy(group.matrixWorld);
    for (const id of ["mouth", "hand.R", "sole.L", "wrist.L"]) {
      const local = h.frame(id, "figure");
      const world = h.frame(id, "world");
      if (!local || !world) throw new Error(`${id}: no frame`);
      const p = new Vector3(...local.position).applyMatrix4(toWorld);
      expect(distance(world.position, p.toArray()), id).toBeLessThan(1e-9);
      for (const k of ["normal", "tangent", "bitangent"] as const) {
        const d = new Vector3(...local[k]).transformDirection(toWorld);
        expect(distance(world[k], d.toArray()), `${id} ${k}`).toBeLessThan(1e-9);
      }
    }
    // A point a centimetre into the open mouth, given in world space, is inside it.
    h.set("mouth", { opening: 1 });
    const mouth = h.channel("mouth");
    if (!mouth) throw new Error("no mouth");
    const inside = new Vector3(...mouth.origin)
      .addScaledVector(new Vector3(...mouth.inward), 0.01)
      .applyMatrix4(toWorld);
    const place = h.place("mouth", inside.toArray());
    expect(place?.inside).toBe(true);
    // Its depth is in world metres: the figure is scaled by 1.25.
    expect(place?.depth).toBeCloseTo(0.0125, 9);
    const outside = new Vector3(...mouth.origin)
      .addScaledVector(new Vector3(...mouth.inward), -0.01)
      .applyMatrix4(toWorld);
    expect(h.place("mouth", outside.toArray())?.inside).toBe(false);
  });

  it("has no frame until the figure is drawn and its anchors have arrived", () => {
    const recipe = createRecipe();
    const h = new HumanoidAffordances();
    h.setRecipe(recipe);
    expect(h.frame("mouth")).toBeNull();
    h.attach(liveFigure(recipe, REST_POSE));
    expect(h.frame("mouth")).toBeNull();
    h.setAnchors(anchors);
    expect(h.frame("mouth")).not.toBeNull();
    h.attach(null);
    expect(h.frame("mouth")).toBeNull();
  });

  it("keeps its clip on the figure's channels as drawn, reusing them each frame, and lets go when the figure does", () => {
    const recipe = createRecipe();
    const h = new HumanoidAffordances();
    h.setRecipe(recipe);
    h.setAnchors(anchors);
    h.set("mouth", { opening: 1 });
    const group = new Group();
    h.attach(liveFigure(recipe, REST_POSE, group));
    const clip = h.clip;
    h.refreshClip();
    const count = clip.uniforms.hkClipCount.value;
    expect(count).toBe(5);
    // The channels the clip holds are the handle's own, written again in place: the mouth's
    // rim is where a fresh read puts it.
    const origin = clip.uniforms.hkClipOrigin.value[0]?.clone();
    h.refreshClip();
    expect(clip.uniforms.hkClipOrigin.value[0]?.equals(origin as Vector3)).toBe(true);
    const mouth = h.channel("mouth");
    expect(mouth?.depth).toBeGreaterThan(0);
    // A figure drawn on demand is told the mouth changed, so it draws the opened jaw.
    let told = 0;
    const stop = h.onJawChange(() => told++);
    h.set("mouth", { opening: 0.5 });
    h.set("ear-canal.L", { opening: 0.5 });
    expect(told).toBe(1);
    stop();
    h.set("mouth", { opening: 0.2 });
    expect(told).toBe(1);
    // Gone: the clip holds nothing, so a held prop is drawn whole, not cut at a mouth that is not there.
    h.attach(null);
    expect(clip.uniforms.hkClipCount.value).toBe(0);
  });

  it("gives a figure under 18 none of the adult anatomy's, and rebuilds its own and their states when the recipe crosses 18", () => {
    const packAperture = {
      id: "a-pack-aperture",
      kind: "aperture",
      at: { landmark: "pubic-point" },
      adult: true,
    } as const;
    const registry = [...CORE_AFFORDANCES, packAperture];
    const h = new HumanoidAffordances(registry);
    const child = createRecipe({ macros: { age: 10 } });
    const adult = createRecipe({ macros: { age: 30 } });
    h.setRecipe(child);
    expect(h.own.map((a) => a.id)).toEqual(affordances(child, registry).map((a) => a.id));
    expect(h.own.some((a) => a.id === packAperture.id)).toBe(false);
    expect(() => h.get(packAperture.id)).toThrow(RangeError);
    expect(() => h.set(packAperture.id, { opening: 1 })).toThrow(RangeError);
    expect(() => h.frame(packAperture.id)).toThrow(RangeError);
    expect(() => h.channel(packAperture.id)).toThrow(RangeError);
    expect(() => h.place(packAperture.id, [0, 0, 0])).toThrow(RangeError);
    h.set("mouth", { opening: 0.5 });
    // Another recipe of the same age keeps the list and the states.
    const before = h.own;
    h.setRecipe(createRecipe({ macros: { age: 11 } }));
    expect(h.own).toBe(before);
    expect(h.get("mouth")).toMatchObject({ opening: 0.5 });
    // Crossing 18: the adult anatomy's join, and every state starts again.
    h.setRecipe(adult);
    expect(h.own).not.toBe(before);
    expect(h.own.some((a) => a.id === packAperture.id)).toBe(true);
    expect(h.get(packAperture.id)).toMatchObject({ kind: "aperture", opening: 0 });
    expect(h.get("mouth")).toMatchObject({ opening: 0 });
    h.set(packAperture.id, { opening: 1 });
    // And back under 18: gone again, its state with it.
    h.setRecipe(child);
    expect(() => h.get(packAperture.id)).toThrow(RangeError);
    h.setRecipe(adult);
    expect(h.get(packAperture.id)).toMatchObject({ opening: 0 });
  });

  it("tells the figure when the mouth's opening changes, and by how much it opens the jaw", () => {
    const h = new HumanoidAffordances();
    h.setRecipe(createRecipe());
    const seen = h.jawVersion;
    expect(h.jawOpening()).toBe(0);
    h.set("hand.R", { closure: 1 });
    expect(h.jawVersion).toBe(seen);
    h.set("mouth", { opening: 0.7 });
    expect(h.jawVersion).not.toBe(seen);
    expect(h.jawOpening()).toBe(0.7);
  });
});
