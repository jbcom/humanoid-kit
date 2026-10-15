/**
 * The hand contact constraint (docs/INTERACTIONS.md, "Hand contact constraint")
 * on real evaluated figures: two bodies of unequal heights, bound to one running
 * interaction through the presence registry, each closing its own final skinned
 * hand on the runtime's shared target. Every separation here is measured from
 * the render path's affordance frames (`HumanoidAffordances.frame`), never from
 * the solver's own report.
 */
import { Group, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { animationsPack } from "../packs/animations/index.js";
import { HumanoidAffordances, type LiveFigure } from "../src/affordance/live.ts";
import { sampleClip } from "../src/animation/clip.ts";
import { loadAnimationLibrary } from "../src/animation/library.ts";
import { type FrameOut, frameOut, landmarkAnchors } from "../src/foundation/landmarks.ts";
import { fitGripMeeting, gripMeeting, gripWorkspaceRadius } from "../src/interaction/contacts.ts";
import type { InteractionDefinition } from "../src/interaction/definition.ts";
import {
  createHandContact,
  type HandContactFigure,
  type HandContactReport,
  handContactSide,
} from "../src/interaction/handContact.ts";
import { createInteractions, type Interaction } from "../src/interaction/runtime.ts";
import type { Evaluation } from "../src/model/humanoidModel.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { placePresence, presenceJoints } from "../src/presence/fromEvaluation.ts";
import { measuredHandWorkspaces } from "../src/presence/handWorkspace.ts";
import {
  groundOffsetOf,
  type PosedRig,
  posedControl,
  presenceFromPose,
} from "../src/presence/posed.ts";
import {
  createPresenceRegistry,
  type FigurePresence,
  type PresenceRegistry,
  type Vec3,
} from "../src/presence/presence.ts";
import { createRecipe, type Recipe } from "../src/recipe/recipe.ts";
import { armChain } from "../src/rig/armTarget.ts";
import { skinPose } from "../src/rig/dual.ts";
import { posedBones, type RestBones, restBones, rigData } from "../src/rig/pose.ts";
import { mul, type Quat } from "../src/rig/quat.ts";
import { poseShare, skinDualShare } from "../src/rig/skinShare.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const model = new HumanoidModel(assets, { subdivision: 1 });
const data = rigData(assets);
const rig: PosedRig = { bones: data.bones, parents: model.boneParents(), skin: model.rigSkin() };
const joints = presenceJoints(assets);
const anchors = landmarkAnchors(model, "base");
const BONES = data.bones.length;
const CLIP_SECONDS = 2.5;

/** The clip pose under each figure: the packaged idle, as the handshake lab samples it. */
let idle: Float32Array;
beforeAll(async () => {
  const library = await loadAnimationLibrary(animationsPack);
  const clip = await library.load("idle1", data.bones);
  idle = sampleClip(clip, 0.4, new Float32Array(BONES * 4));
});

const dist = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  Math.hypot(
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  );
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  (a[0] as number) * (b[0] as number) +
  (a[1] as number) * (b[1] as number) +
  (a[2] as number) * (b[2] as number);

type Side = "L" | "R";

/** A handshake on the `side` hands, contact during act only, slots standing back by `times` × reach. */
function handshake(
  side: Side,
  options: { id?: string; times?: number; audience?: "all" | "adult"; uses?: string[] } = {},
): InteractionDefinition {
  const times = options.times ?? -0.7;
  const uses = (options.uses ?? [`arm.${side}`, `hand.${side}`, "gaze"]) as never;
  const role = (name: string) => ({
    name,
    takes: "figure" as const,
    affordances: [`hand.${side}`],
    uses,
    slot: {
      offset: [0, 0, { of: name, measure: "reach" as const, times }] as never,
      yaw: 0,
      tolerance: 0.04,
    },
    track: { act: { clip: "idle1", loop: true } },
  });
  return {
    id: options.id ?? `handshake.${side}`,
    tags: ["greeting.handshake"],
    audience: options.audience ?? "all",
    roles: [role("initiator"), role("responder")],
    reference: { between: ["initiator", "responder"] },
    contacts: [
      { name: "grip", a: `initiator:hand.${side}`, b: `responder:hand.${side}`, during: ["act"] },
    ],
    alignSeconds: 0.2,
    releaseSeconds: 0.6,
  };
}

interface Body {
  id: string;
  recipe: Recipe;
  evaluation: Evaluation;
  rest: RestBones;
  /** The figure's presence in the clip pose at the origin, re-placed as it moves. */
  posed: FigurePresence;
  /** The lifted group: the figure's own space, as `<Humanoid>` draws it. */
  world: Group;
  lift: number;
  figure: HandContactFigure;
}

function body(id: string, macros: Recipe["macros"] extends infer M ? Partial<M> : never): Body {
  const recipe = createRecipe({ macros: { age: 30, ...macros } });
  const evaluation = model.evaluate(recipe);
  const rest = restBones(assets, evaluation.control);
  const posed = presenceFromPose({
    evaluation,
    recipe,
    joints,
    rig,
    rotations: idle,
    placement: { id, position: [0, 0, 0], facing: [0, 0, 1] },
    hands: {
      anchors,
      skinIndex: model.topology().body.skinIndex,
      skinWeight: model.topology().body.skinWeight,
    },
  });
  const lift = groundOffsetOf(posedControl(rig, evaluation, idle), rig.skin.bodyVertices);
  const world = new Group();
  const figure: HandContactFigure = {
    participant: id,
    generation: evaluation,
    restBones: rest,
    rest: evaluation.positions,
    restNormals: evaluation.normals,
    skinIndex: model.topology().body.skinIndex,
    skinWeight: model.topology().body.skinWeight,
    anchors,
    figureToWorld: world.matrixWorld.elements,
  };
  return { id, recipe, evaluation, rest, posed, world, lift, figure };
}

/** Puts the body on the ground at `position`, facing `facing`, in the registry and its drawn group. */
function place(registry: PresenceRegistry, b: Body, position: Vec3, facing: Vec3): void {
  registry.set(placePresence(b.posed, { id: b.id, position, facing }));
  b.world.position.set(position[0], position[1] + b.lift, position[2]);
  b.world.rotation.set(0, Math.atan2(facing[0], facing[2]), 0);
  b.world.updateMatrixWorld(true);
}

/** The final skinned hand frame as the renderer's affordance handle reads it, in world space. */
function renderedHand(b: Body, rotations: Float32Array, side: Side): FrameOut {
  const pose = skinPose(
    b.rest,
    rotations,
    poseShare(b.rest, rotations, skinDualShare(b.rest.names)),
  );
  const live: LiveFigure = {
    surface: b.evaluation.surface,
    rest: b.evaluation.positions,
    restNormals: b.evaluation.normals,
    skinIndex: model.topology().body.skinIndex,
    skinWeight: model.topology().body.skinWeight,
    pose: () => pose,
    folds: () => [],
    skeleton: () => posedBones(b.rest, rotations),
    world: b.world,
  };
  const handle = new HumanoidAffordances();
  handle.setRecipe(b.recipe);
  handle.setAnchors({ base: anchors, adult: null });
  handle.attach(live);
  const frame = handle.frame(`hand.${side}`, "world", frameOut());
  if (!frame) throw new Error("the rendered hand was not framed");
  return frame;
}

interface Pair {
  registry: PresenceRegistry;
  interaction: Interaction;
  a: Body;
  b: Body;
  clock: { seconds: number };
  tick(dt: number): void;
}

/** Two bodies proposed into `definition`, walked onto their slots and run into act. */
function pair(
  definition: InteractionDefinition,
  a: Body,
  b: Body,
  options: { apart?: number } = {},
): Pair {
  const registry = createPresenceRegistry();
  const apart = options.apart ?? 3;
  place(registry, a, [-apart, 0, 0], [1, 0, 0]);
  place(registry, b, [apart, 0, 0], [-1, 0, 0]);
  const runtime = createInteractions(registry, { seed: 5, clipLength: () => CLIP_SECONDS });
  runtime.define([definition]);
  runtime.policy(a.id, () => true);
  runtime.policy(b.id, () => true);
  const clock = { seconds: 0 };
  const tick = (dt: number) => {
    clock.seconds += dt;
    registry.tick(clock.seconds);
  };
  registry.tick(0);
  const interaction = runtime.propose(definition.id, { initiator: a.id, responder: b.id });
  tick(0.05);
  expect(interaction.phase).toBe("approach");
  for (const [role, who] of [
    ["initiator", a],
    ["responder", b],
  ] as const) {
    const slot = interaction.slot(role);
    if (!slot) throw new Error(`${role} has no slot`);
    place(registry, who, [...slot.position] as Vec3, [...slot.facing] as Vec3);
  }
  tick(0.05);
  expect(interaction.phase).toBe("align");
  tick(0.25);
  expect(interaction.phase).toBe("act");
  return { registry, interaction, a, b, clock, tick };
}

interface Solved {
  rotations: Float32Array;
  report: HandContactReport;
  hand: FrameOut;
}

function solve(
  contact: ReturnType<typeof createHandContact>,
  b: Body,
  interaction: Interaction | null,
  role: string,
  side: Side,
  dt = 1 / 60,
): Solved {
  const out = new Float32Array(BONES * 4);
  const report = contact.update({
    binding: interaction && { interaction, role, contact: "grip" },
    figure: b.figure,
    source: idle,
    dt,
    out,
  });
  return { rotations: out, report: { ...report }, hand: renderedHand(b, out, side) };
}

function segmentLengths(rest: RestBones, rotations: Float32Array, chain: readonly number[]) {
  const heads = posedBones(rest, rotations).heads;
  return chain.slice(1).map((bone, k) => {
    const p = chain[k] as number;
    return dist(heads.subarray(bone * 3, bone * 3 + 3), heads.subarray(p * 3, p * 3 + 3));
  });
}

/** Every bone outside the arm keeps the clip's rotation exactly. */
function expectOnlyArmMoved(rotations: Float32Array, chain: readonly number[]) {
  const arm = new Set(chain);
  for (let bone = 0; bone < BONES; bone++) {
    if (arm.has(bone)) continue;
    for (let c = 0; c < 4; c++)
      expect(rotations[bone * 4 + c], `${data.bones[bone]}`).toBe(idle[bone * 4 + c]);
  }
}

/** The elbow sits below the shoulder-to-hand line and to the arm's own side of the figure. */
function expectSensibleElbow(b: Body, rotations: Float32Array, side: Side) {
  const chain = armChain(b.rest, side);
  const heads = posedBones(b.rest, rotations).heads;
  const at = (k: number) => {
    const bone = chain[k] as number;
    return new Vector3(heads[bone * 3], heads[bone * 3 + 1], heads[bone * 3 + 2]);
  };
  const shoulder = at(1);
  const elbow = at(3);
  const wrist = at(5);
  const upper = elbow.clone().sub(shoulder);
  const fore = wrist.clone().sub(elbow);
  // Flexion between the upper arm and forearm: bent, neither locked straight nor folded shut.
  const flexion = (upper.angleTo(fore) * 180) / Math.PI;
  expect(flexion, "elbow flexion in degrees").toBeGreaterThan(15);
  expect(flexion, "elbow flexion in degrees").toBeLessThan(135);
  // Below the straight line from the shoulder to the wrist (figure space, +y up).
  const t =
    elbow.clone().sub(shoulder).dot(wrist.clone().sub(shoulder)) /
    wrist.clone().sub(shoulder).lengthSq();
  const onLine = shoulder.clone().lerp(wrist, t);
  expect(elbow.y, "elbow below the shoulder-to-wrist line").toBeLessThan(onLine.y);
  // Out to the arm's own side (figure +x is left).
  const outward = side === "L" ? 1 : -1;
  expect((elbow.x - shoulder.x) * outward, "elbow out to its own side").toBeGreaterThan(-0.02);
}

const PAIRS: readonly {
  name: string;
  a: Partial<Recipe["macros"]>;
  b: Partial<Recipe["macros"]>;
}[] = [
  { name: "tall and short", a: { gender: 0.85, height: 0.8 }, b: { gender: 0.15, height: 0.2 } },
  { name: "short and tall", a: { gender: 0.3, height: 0.25 }, b: { gender: 0.9, height: 0.95 } },
  { name: "matched average", a: { gender: 0.5, height: 0.5 }, b: { gender: 0.5, height: 0.5 } },
];

describe("hand contact constraint", { timeout: 600_000 }, () => {
  it("reads the hand a contact asks of a role from its endpoint", () => {
    expect(handContactSide(handshake("R"), "grip", "initiator")).toBe("R");
    expect(handContactSide(handshake("L"), "grip", "responder")).toBe("L");
    expect(handContactSide(handshake("L"), 0, "responder")).toBe("L");
    expect(handContactSide(handshake("R"), "grip", "bystander")).toBeNull();
    expect(handContactSide(handshake("R"), "missing", "initiator")).toBeNull();
  });

  for (const side of ["R", "L"] as const)
    for (const fixture of PAIRS)
      it(`closes ${fixture.name} figures' rendered ${side} hands on one shared target`, () => {
        const p = pair(handshake(side), body("a", fixture.a), body("b", fixture.b));
        // Past the blend-in on the act's clock.
        p.tick(0.4);
        const target = p.interaction.contactTarget("grip", "initiator");
        if (!target) throw new Error("no target in act");
        // Without the constraint the clip leaves both hands at the figures' sides.
        const before = [renderedHand(p.a, idle, side), renderedHand(p.b, idle, side)];
        for (const hand of before) expect(dist(hand.position, target)).toBeGreaterThan(0.1);

        const results = [
          solve(createHandContact(), p.a, p.interaction, "initiator", side),
          solve(createHandContact(), p.b, p.interaction, "responder", side),
        ] as const;
        for (const [k, r] of results.entries()) {
          const who = k === 0 ? p.a : p.b;
          const gap = dist(r.hand.position, target);
          expect(r.report.state).toBe("holding");
          expect(r.report.side).toBe(side);
          expect(r.report.weight).toBe(1);
          expect(r.report.status, JSON.stringify(r.report)).toBe("reached");
          expect(gap, "rendered hand to target").toBeLessThanOrEqual(0.01);
          // The solver's measured hand is the renderer's.
          expect(dist(r.report.hand, r.hand.position)).toBeLessThan(0.001);
          expect(Math.abs(r.report.distance - gap)).toBeLessThan(0.001);
          const chain = armChain(who.rest, side);
          const lengths = segmentLengths(who.rest, idle, chain);
          for (const [s, length] of segmentLengths(who.rest, r.rotations, chain).entries())
            expect(Math.abs(length - (lengths[s] as number))).toBeLessThan(1e-4);
          expectOnlyArmMoved(r.rotations, chain);
          expectSensibleElbow(who, r.rotations, side);
        }
        const [ra, rb] = results;
        const separation = dist(ra.hand.position, rb.hand.position);
        console.log(`${fixture.name} ${side}: hand-to-hand ${(separation * 100).toFixed(2)} cm`);
        expect(separation, "hand-to-hand separation").toBeLessThanOrEqual(0.02);
        // The palms face each other.
        expect(dot(ra.hand.normal, rb.hand.normal), "palm normals").toBeLessThan(-0.7);

        // Re-deriving each presence from its constrained pose moves the shared
        // target by less than the contact tolerance: no feedback loop.
        const reposed = (who: Body, rotations: Float32Array) =>
          presenceFromPose({
            evaluation: who.evaluation,
            recipe: who.recipe,
            joints,
            rig,
            rotations,
            placement: { id: who.id, position: [0, 0, 0], facing: [0, 0, 1] },
          }).measures;
        const ma = reposed(p.a, ra.rotations);
        const mb = reposed(p.b, rb.rotations);
        expect(Math.abs(ma.shoulderHeight - p.a.posed.measures.shoulderHeight)).toBeLessThan(0.01);
        expect(Math.abs(mb.shoulderHeight - p.b.posed.measures.shoulderHeight)).toBeLessThan(0.01);
      });

  it("plans against measured palms and bend reserve, not the old scalar reach target", () => {
    const a = body("a", PAIRS[0]?.a ?? {}),
      b = body("b", PAIRS[0]?.b ?? {});
    const legacyA = placePresence(a.posed, {
      id: "a",
      position: [-0.7 * a.posed.measures.reach, 0, 0],
      facing: [1, 0, 0],
    });
    const legacyB = placePresence(b.posed, {
      id: "b",
      position: [0.7 * b.posed.measures.reach, 0, 0],
      facing: [-1, 0, 0],
    });
    const oldTarget = gripMeeting(legacyA, legacyB, [0, 0, 0]);
    const oldWorkspace = legacyA.handWorkspaces?.R;
    if (!oldWorkspace) throw new Error("no measured hand workspace");
    expect(dist(oldWorkspace.shoulder, oldTarget)).toBeGreaterThan(
      gripWorkspaceRadius(oldWorkspace),
    );
    expect(fitGripMeeting(legacyA, legacyB, "R", "R", [0, 0, 0])).toBe("outside-workspace");
    const p = pair(handshake("R"), a, b);
    p.tick(0.4);
    const target = p.interaction.contactTarget("grip", "responder");
    if (!target) throw new Error("no planned grip");
    expect(p.interaction.contactWorkspaceStatus?.("grip", "initiator")).toBe("fitted");
    expect(p.interaction.contactTarget("grip", "initiator")).toEqual(target);
    for (const who of [a, b]) {
      const workspace = p.registry.get(who.id)?.handWorkspaces?.R;
      if (!workspace) throw new Error("workspace was lost during placement");
      expect(dist(workspace.shoulder, target)).toBeLessThanOrEqual(
        gripWorkspaceRadius(workspace) + 1e-8,
      );
    }
    const pa = p.registry.get(a.id),
      pb = p.registry.get(b.id);
    if (!pa || !pb) throw new Error("pair left presence");
    const scratch: Vec3 = [0, 0, 0];
    let clock = performance.now();
    for (let i = 0; i < 10000; i++) gripMeeting(pa, pb, scratch);
    const scalarMilliseconds = performance.now() - clock;
    clock = performance.now();
    for (let i = 0; i < 10000; i++) fitGripMeeting(pa, pb, "R", "R", scratch);
    console.log(
      `grip planning 10000 reads: scalar=${scalarMilliseconds.toFixed(3)} ms, measured=${(performance.now() - clock).toFixed(3)} ms`,
    );
    // Evaluation/pose identity reuses the two sampled frames; planning samples no mesh.
    const geometry = {
      anchors,
      skinIndex: model.topology().body.skinIndex,
      skinWeight: model.topology().body.skinWeight,
    };
    const first = measuredHandWorkspaces(a.evaluation, a.rest, idle, geometry, a.lift);
    const started = performance.now();
    for (let i = 0; i < 100; i++)
      expect(measuredHandWorkspaces(a.evaluation, a.rest, idle, geometry, a.lift)).toBe(first);
    console.log(
      `cached measured hand workspace: ${(performance.now() - started).toFixed(3)} ms for 100 reads`,
    );
    const mutable = Float32Array.from(idle);
    expect(measuredHandWorkspaces(a.evaluation, a.rest, mutable, geometry, a.lift)).toBe(first);
    const root = (armChain(a.rest, "R")[0] as number) * 4;
    const before = [...first.R.shoulder];
    mutable.set(
      mul(
        [0, Math.sin(0.025), 0, Math.cos(0.025)],
        Array.from(mutable.slice(root, root + 4)) as unknown as Quat,
      ),
      root,
    );
    const changed = measuredHandWorkspaces(a.evaluation, a.rest, mutable, geometry, a.lift);
    expect(changed).not.toBe(first);
    expect(changed.R.shoulder).not.toEqual(before);
    expect(first.R.shoulder).toEqual(before);
  });

  it("follows a moving contact as both figures are carried along together", () => {
    const p = pair(handshake("R"), body("a", PAIRS[0]?.a ?? {}), body("b", PAIRS[0]?.b ?? {}));
    const ca = createHandContact();
    const cb = createHandContact();
    p.tick(0.4);
    const sa = p.interaction.slot("initiator");
    const sb = p.interaction.slot("responder");
    if (!sa || !sb) throw new Error("no slots");
    const start = { a: [...sa.position] as Vec3, b: [...sb.position] as Vec3 };
    for (let step = 1; step <= 6; step++) {
      const z = step * 0.08;
      place(p.registry, p.a, [start.a[0], 0, start.a[2] + z], [1, 0, 0]);
      place(p.registry, p.b, [start.b[0], 0, start.b[2] + z], [-1, 0, 0]);
      p.tick(1 / 30);
      expect(p.interaction.phase).toBe("act");
      const target = p.interaction.contactTarget("grip", "initiator");
      if (!target) throw new Error("no target");
      const ra = solve(ca, p.a, p.interaction, "initiator", "R");
      const rb = solve(cb, p.b, p.interaction, "responder", "R");
      expect(dist(ra.hand.position, target)).toBeLessThanOrEqual(0.01);
      expect(dist(rb.hand.position, target)).toBeLessThanOrEqual(0.01);
      expect(dist(ra.hand.position, rb.hand.position)).toBeLessThanOrEqual(0.02);
    }
  });

  it("blends in on the act's clock, out across release, and returns to the clip exactly", () => {
    const p = pair(handshake("R"), body("a", PAIRS[0]?.a ?? {}), body("b", PAIRS[0]?.b ?? {}));
    const contact = createHandContact({ blendIn: 0.25 });
    // The act has just begun: nothing is applied at its first instant.
    const first = solve(contact, p.a, p.interaction, "initiator", "R");
    expect(first.report.state).toBe("idle");
    expect([...first.rotations]).toEqual([...idle]);
    // A tenth of a second in: partly blended, not yet held.
    p.tick(0.1);
    const early = solve(contact, p.a, p.interaction, "initiator", "R");
    expect(early.report.state).toBe("blending-in");
    expect(early.report.weight).toBeGreaterThan(0);
    expect(early.report.weight).toBeLessThan(1);
    expect(early.report.status).toBe("unreached");
    expect(early.report.reason).toBe("partial-weight");
    // The same clock gives the same weight: a held presence clock holds the arm.
    expect(solve(contact, p.a, p.interaction, "initiator", "R").report.weight).toBe(
      early.report.weight,
    );
    p.tick(0.3);
    expect(solve(contact, p.a, p.interaction, "initiator", "R").report.state).toBe("holding");
    // Run the act out into release.
    while (p.interaction.phase === "act") p.tick(0.1);
    expect(p.interaction.phase).toBe("release");
    let last = 1;
    while (p.interaction.phase === "release") {
      const r = solve(contact, p.a, p.interaction, "initiator", "R");
      expect(r.report.state).toBe("releasing");
      expect(r.report.weight).toBeLessThanOrEqual(last);
      last = r.report.weight;
      p.tick(0.1);
    }
    expect(p.interaction.phase).toBe("ended");
    expect(p.interaction.endReason).toBeNull();
    const done = solve(contact, p.a, p.interaction, "initiator", "R");
    expect(done.report.state).toBe("idle");
    expect(done.report.weight).toBe(0);
    expect([...done.rotations]).toEqual([...idle]);
  });

  it("fades from the last target after a graceful cancel and drops at once on an age-policy abort", () => {
    const graceful = pair(
      handshake("R"),
      body("a", PAIRS[0]?.a ?? {}),
      body("b", PAIRS[0]?.b ?? {}),
    );
    const contact = createHandContact({ blendOut: 0.3 });
    graceful.tick(0.4);
    const held = solve(contact, graceful.a, graceful.interaction, "initiator", "R");
    expect(held.report.state).toBe("holding");
    graceful.interaction.cancel("cancelled");
    expect(graceful.interaction.endReason).toBe("cancelled");
    const fading = solve(contact, graceful.a, graceful.interaction, "initiator", "R", 0.1);
    expect(fading.report.state).toBe("fading");
    expect(fading.report.weight).toBeGreaterThan(0);
    expect(fading.report.weight).toBeLessThan(1);
    // Still toward the last target, not toward the clip's hand.
    expect(dist(fading.hand.position, held.hand.position)).toBeLessThan(
      dist(renderedHand(graceful.a, idle, "R").position, held.hand.position),
    );
    solve(contact, graceful.a, graceful.interaction, "initiator", "R", 0.1);
    const gone = solve(contact, graceful.a, graceful.interaction, "initiator", "R", 0.2);
    expect(gone.report.state).toBe("idle");
    expect([...gone.rotations]).toEqual([...idle]);

    // An adult-audience definition whose participant stops being an adult is
    // aborted by the runtime; the arm drops in the same frame, with no blend.
    const adultPair = pair(
      handshake("R", { id: "handshake.adult-test", audience: "adult" }),
      body("a", PAIRS[0]?.a ?? {}),
      body("b", PAIRS[0]?.b ?? {}),
    );
    const abortContact = createHandContact({ blendOut: 0.3 });
    adultPair.tick(0.4);
    expect(
      solve(abortContact, adultPair.a, adultPair.interaction, "initiator", "R").report.state,
    ).toBe("holding");
    const published = adultPair.registry.get("b");
    if (!published) throw new Error("b is not published");
    published.adult = false;
    adultPair.tick(1 / 60);
    expect(adultPair.interaction.endReason).toBe("age-policy");
    const dropped = solve(abortContact, adultPair.a, adultPair.interaction, "initiator", "R");
    expect(dropped.report.state).toBe("idle");
    expect(dropped.report.weight).toBe(0);
    expect([...dropped.rotations]).toEqual([...idle]);
  });

  it("refuses a figure that does not own the contact's arm and leaves its pose untouched", () => {
    const p = pair(handshake("R"), body("a", PAIRS[0]?.a ?? {}), body("b", PAIRS[0]?.b ?? {}));
    p.tick(0.4);
    // Bound as the other role's figure.
    const imposter = solve(createHandContact(), p.b, p.interaction, "initiator", "R");
    expect(imposter.report.state).toBe("refused");
    expect(imposter.report.reason).toBe("not-a-participant");
    expect([...imposter.rotations]).toEqual([...idle]);
    // A contact the definition does not have.
    const out = new Float32Array(BONES * 4);
    const unknown = createHandContact().update({
      binding: { interaction: p.interaction, role: "initiator", contact: "hug" },
      figure: p.a.figure,
      source: idle,
      dt: 1 / 60,
      out,
    });
    expect(unknown.reason).toBe("unknown-contact");
    expect([...out]).toEqual([...idle]);

    // A role that does not claim the arm may not move it.
    const unclaimed = pair(
      handshake("R", { id: "handshake.unclaimed", uses: ["hand.R", "gaze"] }),
      body("a", PAIRS[0]?.a ?? {}),
      body("b", PAIRS[0]?.b ?? {}),
    );
    unclaimed.tick(0.4);
    const r = solve(createHandContact(), unclaimed.a, unclaimed.interaction, "initiator", "R");
    expect(r.report.state).toBe("refused");
    expect(r.report.reason).toBe("not-claimed");
    expect([...r.rotations]).toEqual([...idle]);
  });

  it("reports a contact out of reach and never stretches the arm", () => {
    // Slots three reaches back from the midpoint: the meeting point is far beyond either arm.
    const p = pair(
      handshake("R", { id: "handshake.far", times: -3 }),
      body("a", PAIRS[0]?.a ?? {}),
      body("b", PAIRS[0]?.b ?? {}),
      { apart: 4 },
    );
    p.tick(0.4);
    const target = p.interaction.contactTarget("grip", "initiator");
    if (!target) throw new Error("no target");
    const r = solve(createHandContact(), p.a, p.interaction, "initiator", "R");
    expect(r.report.state).toBe("holding");
    expect(r.report.status).toBe("unreached");
    expect(r.report.reason).toBe("geometrically-unreachable");
    expect(p.interaction.contactWorkspaceStatus?.("grip", "initiator")).toBe("outside-workspace");
    expect(r.report.geometricallyReachable).toBe(false);
    const gap = dist(r.hand.position, target);
    expect(gap).toBeGreaterThan(0.3);
    expect(Math.abs(r.report.distance - gap)).toBeLessThan(0.001);
    const chain = armChain(p.a.rest, "R");
    const lengths = segmentLengths(p.a.rest, idle, chain);
    for (const [s, length] of segmentLengths(p.a.rest, r.rotations, chain).entries())
      expect(Math.abs(length - (lengths[s] as number))).toBeLessThan(1e-4);
    // It reaches toward the target as far as the arm allows.
    expect(gap).toBeLessThan(dist(renderedHand(p.a, idle, "R").position, target));
  });
});
