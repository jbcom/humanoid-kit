/**
 * The framework-free arm target solver: it works from an evaluated adult rig
 * and its final, skinned hand.R affordance frame.  React is deliberately not
 * involved: this is the contract a later renderer binding will consume.
 */
import { Group, Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { HumanoidAffordances, type LiveFigure } from "../src/affordance/live.ts";
import { type FrameOut, frameOut, landmarkAnchors } from "../src/foundation/landmarks.ts";
import { type Evaluation, HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe, type Recipe } from "../src/recipe/recipe.ts";
import { type ArmTip, armChain, armTip, solveArmTarget } from "../src/rig/armTarget.ts";
import { skinPose } from "../src/rig/dual.ts";
import { IDENTITY_POSE, posedBones, type RestBones, restBones, rigData } from "../src/rig/pose.ts";
import { poseShare, skinDualShare } from "../src/rig/skinShare.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const model = new HumanoidModel(assets, { subdivision: 1 });
const rigDataFor = rigData(assets);
const base = IDENTITY_POSE(rigDataFor.bones.length);
const anchors = { base: landmarkAnchors(model, "base"), adult: null };

const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  );

function live(evaluation: Evaluation, rotations: Float32Array, world: Group): LiveFigure {
  const rest = restBones(assets, evaluation.control);
  const pose = skinPose(rest, rotations, poseShare(rest, rotations, skinDualShare(rest.names)));
  return {
    surface: evaluation.surface,
    rest: Float32Array.from(evaluation.positions),
    restNormals: Float32Array.from(evaluation.normals),
    skinIndex: model.topology().body.skinIndex,
    skinWeight: model.topology().body.skinWeight,
    pose: () => pose,
    folds: () => [],
    skeleton: () => posedBones(rest, rotations),
    world,
  };
}

function handFrame(
  recipe: Recipe,
  evaluation: Evaluation,
  rotations: Float32Array,
  world: Group,
  space: "figure" | "world" = "world",
  side: "L" | "R" = "R",
) {
  const handle = new HumanoidAffordances();
  handle.setRecipe(recipe);
  handle.setAnchors(anchors);
  handle.attach(live(evaluation, rotations, world));
  const id = `hand.${side}` as const;
  const frame = handle.frame(id, space, frameOut());
  if (!frame) throw new Error(`${id} was not framed`);
  return frame;
}

function orientation(frame: FrameOut): [number, number, number, number] {
  const q = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(
      new Vector3(...frame.tangent),
      new Vector3(...frame.bitangent),
      new Vector3(...frame.normal),
    ),
  );
  return [q.x, q.y, q.z, q.w];
}

function solveActualHand(input: {
  recipe: Recipe;
  evaluation: Evaluation;
  rest: ReturnType<typeof restBones>;
  world: Group;
  target: readonly [number, number, number];
  side?: "L" | "R";
  pole?: readonly [number, number, number];
  orientation?: readonly [number, number, number, number];
  orientationTolerance?: number;
  limits?: readonly { maxRadians: number }[];
  weight?: number;
}) {
  const side = input.side ?? "R";
  const chain = armChain(input.rest, side);
  const before = handFrame(input.recipe, input.evaluation, base, input.world, "figure", side);
  const tip = armTip(input.rest, base, chain, before.position, orientation(before));
  const sample = (rotations: Float32Array) => {
    const frame = handFrame(input.recipe, input.evaluation, rotations, input.world, "figure", side);
    return { position: frame.position, orientation: orientation(frame) };
  };
  return solveArmTarget({
    rest: input.rest,
    rotations: base,
    chain,
    tip,
    target: {
      position: input.target,
      ...(input.orientation && {
        orientation: [...input.orientation] as [number, number, number, number],
      }),
    },
    ...(input.pole && { pole: input.pole }),
    ...(input.limits && { limits: input.limits }),
    ...(input.weight !== undefined && { weight: input.weight }),
    tolerance: 0.01,
    ...(input.orientationTolerance !== undefined && {
      orientationTolerance: input.orientationTolerance,
    }),
    effector: sample,
  });
}

function toLocal(world: Group, point: readonly number[]) {
  world.updateWorldMatrix(true, false);
  return new Vector3(...point).applyMatrix4(world.matrixWorld.clone().invert()).toArray() as [
    number,
    number,
    number,
  ];
}

function adult(recipe = createRecipe({ macros: { age: 30, gender: 0.5, height: 0.5 } })) {
  const evaluation = model.evaluate(recipe);
  const rest = restBones(assets, evaluation.control);
  const world = new Group();
  world.position.y = evaluation.groundOffset;
  return { recipe, evaluation, rest, world };
}

function point(heads: Float32Array, bone: number): [number, number, number] {
  return [heads[bone * 3] as number, heads[bone * 3 + 1] as number, heads[bone * 3 + 2] as number];
}

function segmentLengths(
  rest: ReturnType<typeof restBones>,
  rotations: Float32Array,
  chain: readonly number[],
) {
  const heads = posedBones(rest, rotations).heads;
  return chain
    .slice(1)
    .map((bone, index) => dist(point(heads, bone), point(heads, chain[index] as number)));
}

function quatAngle(a: ArrayLike<number>, b: ArrayLike<number>) {
  const dot = Math.abs(
    (a[0] ?? 0) * (b[0] ?? 0) +
      (a[1] ?? 0) * (b[1] ?? 0) +
      (a[2] ?? 0) * (b[2] ?? 0) +
      (a[3] ?? 0) * (b[3] ?? 0),
  );
  return 2 * Math.acos(Math.min(1, Math.max(-1, dot)));
}

function elbowSide(
  rest: ReturnType<typeof restBones>,
  rotations: Float32Array,
  chain: readonly number[],
  target: readonly [number, number, number],
  pole: readonly [number, number, number],
) {
  const heads = posedBones(rest, rotations).heads;
  const root = point(heads, chain[0] as number);
  const elbow = point(heads, chain[3] as number);
  const a: [number, number, number] = [
    target[0] - root[0],
    target[1] - root[1],
    target[2] - root[2],
  ];
  // Positive when the elbow's offset from the shoulder-to-target line points
  // toward the pole's. A triple product (a × elbow) · pole would instead measure
  // the elbow's distance out of the pole's plane, which a solved pole drives to
  // zero, so its sign would be float noise exactly when the solve is right.
  const perp = (point: readonly number[]): [number, number, number] => {
    const v = [
      (point[0] as number) - root[0],
      (point[1] as number) - root[1],
      (point[2] as number) - root[2],
    ] as const;
    const along = (v[0] * a[0] + v[1] * a[1] + v[2] * a[2]) / (a[0] ** 2 + a[1] ** 2 + a[2] ** 2);
    return [v[0] - a[0] * along, v[1] - a[1] * along, v[2] - a[2] * along];
  };
  const b = perp(elbow);
  const c = perp(pole);
  return b[0] * c[0] + b[1] * c[1] + b[2] * c[2];
}

function syntheticArm() {
  const chain = [0, 1, 2, 3, 4, 5];
  const rest: RestBones = {
    names: chain.map((index) => `joint-${index}`),
    parents: Int16Array.from([-1, 0, 1, 2, 3, 4]),
    heads: Float32Array.from(chain.flatMap((index) => [index, 0, 0])),
    order: Int16Array.from(chain),
  };
  const source = IDENTITY_POSE(chain.length);
  const tip: ArmTip = { position: [1, 0, 0], orientation: [0, 0, 0, 1] };
  return { rest, chain, source, tip };
}

function rigidFrame(
  rest: RestBones,
  rotations: Float32Array,
  chain: readonly number[],
  tip: ArmTip,
) {
  const posed = posedBones(rest, rotations);
  const wrist = chain.at(-1) as number;
  const q = new Quaternion().fromArray(posed.world, wrist * 4);
  const position = new Vector3(...tip.position)
    .applyQuaternion(q)
    .add(new Vector3(...point(posed.heads, wrist)))
    .toArray();
  const orientation = q.multiply(new Quaternion(...(tip.orientation ?? [0, 0, 0, 1]))).toArray();
  return { position, orientation };
}

const xRoll = (degrees: number): [number, number, number, number] => [
  Math.sin((degrees * Math.PI) / 360),
  0,
  0,
  Math.cos((degrees * Math.PI) / 360),
];
const normalizedAngle = (a: readonly number[], b: readonly number[]) =>
  new Quaternion().fromArray(a).normalize().angleTo(new Quaternion().fromArray(b).normalize());
const rotationBytes = (values: Float32Array) =>
  new Uint8Array(values.buffer, values.byteOffset, values.byteLength);

describe("arm target constraints", { timeout: 300_000 }, () => {
  it("reaches a legal axial roll beyond the wrist budget without moving the contact", () => {
    const chain = [0, 1, 2, 3, 4, 5];
    const rest: RestBones = {
      names: [
        "shoulder01.R",
        "upperarm01.R",
        "upperarm02.R",
        "lowerarm01.R",
        "lowerarm02.R",
        "wrist.R",
        "other-root",
        "other-child",
      ],
      parents: Int16Array.from([-1, 0, 1, 2, 3, 4, -1, 6]),
      heads: Float32Array.from([
        0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0, 5, 0, 0, 2, 3, 4, 2, 4, 4,
      ]),
      order: Int16Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
    };
    const source = IDENTITY_POSE(rest.names.length);
    // Non-chain rotations are deliberately non-identity so preservation has
    // content beyond retaining zero-filled storage.
    source.set([0, 0, Math.sin(0.17), Math.cos(0.17)], 6 * 4);
    source.set([0, Math.sin(0.23), 0, Math.cos(0.23)], 7 * 4);
    const tip = {
      position: [1, 0, 0] as const,
      orientation: [0, 0, 0, 1] as [number, number, number, number],
    };
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    const roll = (degrees: number): [number, number, number, number] => [
      Math.sin(radians(degrees) / 2),
      0,
      0,
      Math.cos(radians(degrees) / 2),
    ];
    const target = { position: [6, 0, 0] as const, orientation: roll(120) };
    // These are the existing default source-angle budgets, not replacements
    // passed into the solver. The regression must exercise its defaults.
    const budgets = [130, 35, 35, 150, 50, 85].map(radians);
    const inputsBefore = structuredClone({ rest, source, chain, tip, target, budgets });
    const bytes = (values: Float32Array | Int16Array) =>
      new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    const measure = (rotations: Float32Array) => {
      const posed = posedBones(rest, rotations);
      const wrist = chain.at(-1) as number;
      const q = new Quaternion().fromArray(posed.world, wrist * 4);
      const position = new Vector3(...tip.position)
        .applyQuaternion(q)
        .add(new Vector3(...point(posed.heads, wrist)))
        .toArray();
      return { position, orientation: q.toArray() };
    };
    const assertPreserved = (rotations: Float32Array) => {
      expect({ rest, source, chain, tip, target, budgets }).toEqual(inputsBefore);
      expect(bytes(source)).toEqual(bytes(inputsBefore.source));
      expect(bytes(rest.heads)).toEqual(bytes(inputsBefore.rest.heads));
      expect(bytes(rest.parents)).toEqual(bytes(inputsBefore.rest.parents));
      expect(bytes(rest.order)).toEqual(bytes(inputsBefore.rest.order));
      expect(bytes(rotations.subarray(6 * 4))).toEqual(bytes(source.subarray(6 * 4)));
      chain.forEach((bone, index) => {
        expect(
          quatAngle(
            source.subarray(bone * 4, bone * 4 + 4),
            rotations.subarray(bone * 4, bone * 4 + 4),
          ),
        ).toBeLessThanOrEqual((budgets[index] as number) + 1e-6);
      });
      segmentLengths(rest, rotations, chain).forEach((length) => {
        expect(length).toBe(1);
      });
      const measured = measure(rotations);
      expect(dist(measured.position, point(posedBones(rest, rotations).heads, 5))).toBe(1);
      return measured;
    };

    // Construct a legal solution independently of the solver. Both turns are
    // about the collinear arm axis, so their sum changes only the final roll.
    const legal = Float32Array.from(source);
    legal.set(roll(45), 4 * 4);
    legal.set(roll(75), 5 * 4);
    const control = assertPreserved(legal);
    expect(dist(control.position, target.position)).toBe(0);
    expect(quatAngle(control.orientation, target.orientation)).toBeLessThan(0.001);

    const result = solveArmTarget({ rest, rotations: source, chain, tip, target, tolerance: 1e-6 });
    const measured = assertPreserved(result.rotations);
    expect(result.segmentLengths).toEqual([1, 1, 1, 1, 1, 1]);
    expect(result.geometricallyReachable).toBe(true);
    expect(result.distance).toBeLessThanOrEqual(1e-6);
    expect(dist(measured.position, target.position)).toBeLessThanOrEqual(1e-6);
    expect(
      result.status,
      JSON.stringify({
        distance: result.distance,
        orientationError: result.orientationError,
        localAngles: chain.map((bone) =>
          quatAngle(
            source.subarray(bone * 4, bone * 4 + 4),
            result.rotations.subarray(bone * 4, bone * 4 + 4),
          ),
        ),
      }),
    ).toBe("reached");
    expect(result.orientationError).not.toBeNull();
    expect(result.orientationError).toBeLessThanOrEqual(0.035);
    expect(quatAngle(measured.orientation, target.orientation)).toBeLessThanOrEqual(0.035);
    expect(
      chain
        .slice(0, -1)
        .some(
          (bone) =>
            quatAngle(
              source.subarray(bone * 4, bone * 4 + 4),
              result.rotations.subarray(bone * 4, bone * 4 + 4),
            ) > 0.01,
        ),
    ).toBe(true);
  });

  it("preserves the source when the measured roll already satisfies the orientation tolerance", () => {
    const { rest, chain, source, tip } = syntheticArm();
    const before = Float32Array.from(source);
    let samples = 0;
    const target = { position: [6, 0, 0] as const, orientation: xRoll(1) };
    const result = solveArmTarget({
      rest,
      rotations: source,
      chain,
      tip,
      target,
      iterations: 1,
      limits: [0, 0, 0, 0, 50, 0].map((degrees) => ({ maxRadians: (degrees * Math.PI) / 180 })),
      effector: (rotations) => {
        samples++;
        return rigidFrame(rest, rotations, chain, tip);
      },
    });
    expect(result.status).toBe("reached");
    expect(result.orientationError).toBeGreaterThan(0.01);
    expect(result.orientationError).toBeLessThanOrEqual(0.035);
    expect(rotationBytes(result.rotations)).toEqual(rotationBytes(before));
    expect(rotationBytes(source)).toEqual(rotationBytes(before));
    // With one legacy iteration, only the initial ancestor measurement is
    // added. No proposal or subsequent ancestor is sampled after satisfaction.
    expect(samples).toBe(15);
  });

  it("stops sampling ancestors after the first accepted roll meets the public tolerance", () => {
    const { rest, chain, source, tip } = syntheticArm();
    let samples = 0;
    const result = solveArmTarget({
      rest,
      rotations: source,
      chain,
      tip,
      target: { position: [6, 0, 0], orientation: xRoll(120) },
      iterations: 1,
      effector: (rotations) => {
        samples++;
        return rigidFrame(rest, rotations, chain, tip);
      },
    });
    expect(result.status).toBe("reached");
    expect(result.orientationError).toBeLessThanOrEqual(0.035);
    expect(result.rotations[4 * 4]).toBeGreaterThan(0.1);
    expect(rotationBytes(result.rotations.subarray(0, 4 * 4))).toEqual(
      rotationBytes(source.subarray(0, 4 * 4)),
    );
    // One ancestor baseline, one accepted proposal, then final result sampling.
    expect(samples).toBe(16);
  });

  it("uses the public quaternion metric for satisfaction at a tight orientation tolerance", () => {
    const { rest, chain, source, tip } = syntheticArm();
    const orientationTolerance = 1e-5;
    const target = { position: [6, 0, 0] as const, orientation: xRoll((1e-6 * 180) / Math.PI) };
    const effector = (rotations: Float32Array) => {
      const frame = rigidFrame(rest, rotations, chain, tip);
      // Valid within sampler validation's unit allowance, but its norm error
      // makes the public metric larger than this deliberately tight threshold.
      frame.orientation = frame.orientation.map((component) => component * (1 - 1e-7)) as [
        number,
        number,
        number,
        number,
      ];
      return frame;
    };
    const before = effector(source);
    expect(normalizedAngle(before.orientation, target.orientation)).toBeLessThan(
      orientationTolerance,
    );
    expect(quatAngle(before.orientation, target.orientation)).toBeGreaterThan(orientationTolerance);
    const result = solveArmTarget({
      rest,
      rotations: source,
      chain,
      tip,
      target,
      effector,
      iterations: 1,
      orientationTolerance,
      limits: [0, 0, 0, 0, 50, 0].map((degrees) => ({ maxRadians: (degrees * Math.PI) / 180 })),
    });
    const measured = effector(result.rotations);
    // A normalized satisfaction check would incorrectly skip this legal
    // improvement even though final status still reports above tolerance.
    expect(result.rotations[4 * 4]).toBeGreaterThan(0);
    expect(normalizedAngle(measured.orientation, target.orientation)).toBeLessThan(
      normalizedAngle(before.orientation, target.orientation),
    );
    expect(result.orientationError).toBe(quatAngle(measured.orientation, target.orientation));
    expect(result.orientationError).toBeGreaterThan(orientationTolerance);
    expect(result.distance).toBe(0);
    expect(result.status).toBe("unreached");
  });

  it("composes ancestor roll through a rotated parent and a nonidentity tip frame", () => {
    const { rest, chain, tip } = syntheticArm();
    rest.names.push("parent");
    rest.parents = Int16Array.from([6, 0, 1, 2, 3, 4, -1]);
    rest.heads = Float32Array.from([...rest.heads, 0, 0, 0]);
    rest.order = Int16Array.from([6, ...chain]);
    const source = IDENTITY_POSE(rest.names.length);
    const parent = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.7);
    source.set(parent.toArray(), 6 * 4);
    const tipOrientation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4);
    tip.orientation = tipOrientation.toArray();
    const position = rigidFrame(rest, source, chain, tip).position;
    const orientation = parent
      .clone()
      .multiply(new Quaternion(...xRoll(120)))
      .multiply(tipOrientation)
      .toArray();
    const before = Float32Array.from(source);
    const result = solveArmTarget({
      rest,
      rotations: source,
      chain,
      tip,
      target: { position, orientation },
      tolerance: 1e-6,
    });
    const measured = rigidFrame(rest, result.rotations, chain, tip);
    expect(result.status, JSON.stringify(result)).toBe("reached");
    expect(dist(measured.position, position)).toBeLessThanOrEqual(1e-6);
    expect(normalizedAngle(measured.orientation, orientation)).toBeLessThanOrEqual(0.035);
    expect(result.orientationError).toBeLessThanOrEqual(0.035);
    expect(source).toEqual(before);
    expect(rotationBytes(result.rotations.subarray(6 * 4))).toEqual(
      rotationBytes(before.subarray(6 * 4)),
    );
  });

  it("rolls back the exact local state when a source-budget clamp moves the rigid endpoint", () => {
    const { rest, chain, source, tip } = syntheticArm();
    source.set(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2).toArray(), 0);
    const target = { position: [6, 0, 0] as const, orientation: xRoll(120) };
    const samples: { rotations: Float32Array; distance: number; error: number }[] = [];
    const effector = (rotations: Float32Array) => {
      const frame = rigidFrame(rest, rotations, chain, tip);
      samples.push({
        rotations: Float32Array.from(rotations),
        distance: dist(frame.position, target.position),
        error: normalizedAngle(frame.orientation, target.orientation),
      });
      return frame;
    };
    const result = solveArmTarget({
      rest,
      rotations: source,
      chain,
      tip,
      target,
      effector,
      limits: [90, 0, 0, 0, 0, 85].map((degrees) => ({ maxRadians: (degrees * Math.PI) / 180 })),
      tolerance: 1e-6,
    });
    const rejected = samples.findIndex((sample) => (sample.rotations[0] as number) > 0.01);
    expect(rejected).toBeGreaterThan(0);
    const before = samples[rejected - 1];
    const candidate = samples[rejected];
    if (!before || !candidate) throw new Error("missing clamped twist proposal");
    expect(before.distance).toBeLessThanOrEqual(1e-6);
    expect(candidate.distance).toBeGreaterThan(1e-6);
    expect(candidate.error).toBeLessThan(before.error);
    expect(rotationBytes(result.rotations)).toEqual(rotationBytes(before.rotations));
    expect(result.distance).toBeLessThanOrEqual(1e-6);
    expect(result.status).toBe("unreached");
  });

  it("rejects measured contact motion even when the proposed twist preserves the rigid tip", () => {
    const { rest, chain, source, tip } = syntheticArm();
    const target = { position: [6, 0, 0] as const, orientation: xRoll(120) };
    const samples: { rotations: Float32Array; frame: ReturnType<typeof rigidFrame> }[] = [];
    const effector = (rotations: Float32Array) => {
      const frame = rigidFrame(rest, rotations, chain, tip);
      frame.position[1] += (rotations[4 * 4] as number) * 0.1;
      samples.push({ rotations: Float32Array.from(rotations), frame });
      return frame;
    };
    const result = solveArmTarget({
      rest,
      rotations: source,
      chain,
      tip,
      target,
      effector,
      limits: [0, 0, 0, 0, 50, 85].map((degrees) => ({ maxRadians: (degrees * Math.PI) / 180 })),
      tolerance: 1e-6,
    });
    const rejected = samples.findIndex((sample) => (sample.rotations[4 * 4] as number) > 0.01);
    expect(rejected).toBeGreaterThan(0);
    const before = samples[rejected - 1];
    const candidate = samples[rejected];
    if (!before || !candidate) throw new Error("missing measured-contact twist proposal");
    expect(dist(rigidFrame(rest, candidate.rotations, chain, tip).position, target.position)).toBe(
      0,
    );
    expect(dist(candidate.frame.position, target.position)).toBeGreaterThan(1e-6);
    expect(normalizedAngle(candidate.frame.orientation, target.orientation)).toBeLessThan(
      normalizedAngle(before.frame.orientation, target.orientation),
    );
    expect(rotationBytes(result.rotations)).toEqual(rotationBytes(before.rotations));
    expect(result.distance).toBe(0);
    expect(result.status).toBe("unreached");
  });

  it("rejects a contact-preserving root twist that reverses the declared elbow side", () => {
    const { rest, chain, source, tip } = syntheticArm();
    rest.heads.set([3, 1, 0], 3 * 3);
    rest.heads.set([4, 1, 0], 4 * 3);
    const target = { position: [6, 0, 0] as const, orientation: xRoll(120) };
    const pole = [3, 1, 0] as const;
    const candidates: Float32Array[] = [];
    const result = solveArmTarget({
      rest,
      rotations: source,
      chain,
      tip,
      target,
      pole,
      limits: [130, 0, 0, 0, 0, 0].map((degrees) => ({ maxRadians: (degrees * Math.PI) / 180 })),
      tolerance: 1e-6,
      effector: (rotations) => {
        if ((rotations[0] as number) > 0.1) candidates.push(Float32Array.from(rotations));
        return rigidFrame(rest, rotations, chain, tip);
      },
    });
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];
    if (!candidate) throw new Error("missing pole-reversing twist proposal");
    const frame = rigidFrame(rest, candidate, chain, tip);
    expect(dist(frame.position, target.position)).toBeLessThanOrEqual(1e-6);
    expect(normalizedAngle(frame.orientation, target.orientation)).toBeLessThan(0.001);
    expect(elbowSide(rest, source, chain, target.position, pole)).toBeGreaterThan(0);
    expect(elbowSide(rest, candidate, chain, target.position, pole)).toBeLessThan(0);
    expect(rotationBytes(result.rotations)).toEqual(rotationBytes(source));
    expect(result.status).toBe("unreached");
  });

  it("keeps an orthogonal half-turn with zero axial projection finite and deterministic", () => {
    const { rest, chain, source, tip } = syntheticArm();
    const input = {
      rest,
      rotations: source,
      chain,
      tip,
      target: {
        position: [6, 0, 0] as const,
        orientation: [0, 1, 0, 0] as [number, number, number, number],
      },
      limits: chain.map(() => ({ maxRadians: 0 })),
      tolerance: 1e-6,
    };
    // Allow ancestor twist, while the wrist cannot hide the zero projection.
    input.limits[4] = { maxRadians: (50 * Math.PI) / 180 };
    const first = solveArmTarget(input);
    const second = solveArmTarget(input);
    expect(rotationBytes(first.rotations)).toEqual(rotationBytes(source));
    expect(rotationBytes(second.rotations)).toEqual(rotationBytes(first.rotations));
    expect([...first.rotations].every(Number.isFinite)).toBe(true);
    expect(first.distance).toBe(0);
    expect(first.orientationError).toBe(Math.PI);
    expect(first.status).toBe("unreached");
  });

  it("preserves the position-only quarter-turn result byte for byte", () => {
    const { rest, chain, source, tip } = syntheticArm();
    const result = solveArmTarget({
      rest,
      rotations: source,
      chain,
      tip,
      target: { position: [0, 6, 0] },
      limits: chain.map((_, index) => ({ maxRadians: index === 0 ? Math.PI : 0 })),
      tolerance: 1e-6,
    });
    const expected = Float32Array.from(source);
    expected.set([0, 0, Math.SQRT1_2, Math.SQRT1_2], 0);
    expect(rotationBytes(result.rotations)).toEqual(rotationBytes(expected));
    expect(result.status).toBe("reached");
  });

  it("puts both unequal-height adults' final skinned right hands on the same shared target", () => {
    const tallRecipe = createRecipe({ macros: { age: 25, gender: 0.85, height: 0.8 } });
    const shortRecipe = createRecipe({ macros: { age: 25, gender: 0.15, height: 0.2 } });
    const tallEval = model.evaluate(tallRecipe);
    const shortEval = model.evaluate(shortRecipe);
    const tallRest = restBones(assets, tallEval.control);
    const shortRest = restBones(assets, shortEval.control);
    // This is a fixed world-space target chosen inside both evaluated arm
    // spans. Contact selection belongs to an interaction layer, not this rig
    // solver test.
    const target: [number, number, number] = [0.043, 1.15, 0];
    const tallWorld = new Group();
    tallWorld.position.set(-0.3, 0, 0);
    tallWorld.position.y += tallEval.groundOffset;
    tallWorld.rotation.y = Math.PI / 2;
    const shortWorld = new Group();
    shortWorld.position.set(0.3, 0, 0);
    shortWorld.position.y += shortEval.groundOffset;
    shortWorld.rotation.y = -Math.PI / 2;

    const solve = (
      recipe: Recipe,
      evaluation: Evaluation,
      rest: ReturnType<typeof restBones>,
      world: Group,
    ) => {
      const before = handFrame(recipe, evaluation, base, world);
      const localTarget = toLocal(world, target);
      const result = solveArmTarget({
        rest,
        rotations: base,
        chain: armChain(rest, "R"),
        tip: armTip(rest, base, armChain(rest, "R"), toLocal(world, before.position)),
        target: { position: localTarget },
        tolerance: 0.01,
        effector: (rotations) => ({
          position: toLocal(world, handFrame(recipe, evaluation, rotations, world).position),
        }),
      });
      expect(
        result.status,
        JSON.stringify({
          target,
          localTarget,
          before: before.position,
          worldPosition: world.position.toArray(),
          distance: result.distance,
          orientationError: result.orientationError,
          geometricallyReachable: result.geometricallyReachable,
          segmentLengths: result.segmentLengths,
        }),
      ).toBe("reached");
      expect(result.distance).toBeLessThanOrEqual(0.01);
      const after = handFrame(recipe, evaluation, result.rotations, world);
      expect(dist(after.position, target)).toBeLessThanOrEqual(0.01);
      return result;
    };

    solve(tallRecipe, tallEval, tallRest, tallWorld);
    solve(shortRecipe, shortEval, shortRest, shortWorld);
  });

  it("reaches rendered left and right hand targets without changing evaluated segment lengths", () => {
    const fixture = adult();
    for (const side of ["L", "R"] as const) {
      const before = handFrame(
        fixture.recipe,
        fixture.evaluation,
        base,
        fixture.world,
        "figure",
        side,
      );
      const target: [number, number, number] = [
        before.position[0] + (side === "L" ? -0.08 : 0.08),
        before.position[1] + 0.04,
        before.position[2] - 0.08,
      ];
      const chain = armChain(fixture.rest, side);
      const result = solveActualHand({ ...fixture, target, side });
      expect(result.status, JSON.stringify({ side, distance: result.distance })).toBe("reached");
      expect(result.distance).toBeLessThanOrEqual(0.01);
      const beforeLengths = segmentLengths(fixture.rest, base, chain);
      const afterLengths = segmentLengths(fixture.rest, result.rotations, chain);
      afterLengths.forEach((value, index) => {
        const beforeLength = beforeLengths[index];
        if (beforeLength === undefined) throw new Error("missing source segment length");
        expect(Math.abs(value - beforeLength)).toBeLessThan(0.0001);
      });
    }
  });

  it("reports an unreachable final hand target and never scales the adult arm", () => {
    const fixture = adult();
    const before = handFrame(fixture.recipe, fixture.evaluation, base, fixture.world, "figure");
    const restHeads = Float32Array.from(fixture.rest.heads);
    const result = solveActualHand({
      ...fixture,
      target: [before.position[0] + 5, before.position[1], before.position[2]],
    });
    expect(result.geometricallyReachable).toBe(false);
    expect(result.status).toBe("unreached");
    expect(result.reason).toBe("geometrically-unreachable");
    expect(result.distance).toBeGreaterThan(1);
    expect([...fixture.rest.heads]).toEqual([...restHeads]);
    expect(result.segmentLengths.reduce((sum, length) => sum + length, 0)).toBeLessThan(1);
  });

  it("honours hard joint limits and blends contact transitions continuously", () => {
    const fixture = adult();
    const before = handFrame(fixture.recipe, fixture.evaluation, base, fixture.world, "figure");
    const target: [number, number, number] = [
      before.position[0] + 0.08,
      before.position[1] + 0.04,
      before.position[2] - 0.08,
    ];
    const chain = armChain(fixture.rest, "R");
    const locked = solveActualHand({
      ...fixture,
      target,
      limits: chain.map(() => ({ maxRadians: 0 })),
    });
    expect(locked.status).toBe("unreached");
    expect(locked.reason).toBe("tolerance-not-reached");
    expect([...locked.rotations]).toEqual([...base]);

    const full = solveActualHand({ ...fixture, target, weight: 1 });
    const half = solveActualHand({ ...fixture, target, weight: 0.5 });
    const none = solveActualHand({ ...fixture, target, weight: 0 });
    expect(full.status).toBe("reached");
    expect(half.status).toBe("unreached");
    expect(half.reason).toBe("partial-weight");
    expect([...none.rotations]).toEqual([...base]);
    for (const bone of chain) {
      const source = base.slice(bone * 4, bone * 4 + 4);
      const fullRotation = full.rotations.slice(bone * 4, bone * 4 + 4);
      const halfRotation = half.rotations.slice(bone * 4, bone * 4 + 4);
      const fullAngle = quatAngle(source, fullRotation);
      const halfAngle = quatAngle(source, halfRotation);
      expect(halfAngle).toBeLessThanOrEqual(fullAngle + 1e-5);
      if (fullAngle > 0.005) expect(halfAngle / fullAngle).toBeGreaterThan(0.35);
    }
  });

  it("closes an actual rendered hand orientation as well as its contact point", () => {
    const fixture = adult();
    const before = handFrame(fixture.recipe, fixture.evaluation, base, fixture.world, "figure");
    const desired = new Quaternion(...orientation(before)).multiply(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.1),
    );
    const result = solveActualHand({
      ...fixture,
      target: before.position,
      orientation: [desired.x, desired.y, desired.z, desired.w],
      orientationTolerance: 0.04,
    });
    expect(
      result.status,
      JSON.stringify({ distance: result.distance, orientationError: result.orientationError }),
    ).toBe("reached");
    expect(result.distance).toBeLessThanOrEqual(0.01);
    const orientationError = result.orientationError;
    expect(orientationError).not.toBeNull();
    if (orientationError === null)
      throw new Error("orientation solve did not return an orientation error");
    expect(orientationError).toBeLessThanOrEqual(0.04);
  });

  it("uses an orientation supplied by a skinned-frame effector without requiring a tip orientation", () => {
    const fixture = adult();
    const chain = armChain(fixture.rest, "R");
    const wrist = chain.at(-1) as number;
    const before = handFrame(fixture.recipe, fixture.evaluation, base, fixture.world, "figure");
    const sourceOrientation = orientation(before);
    const desired = new Quaternion(...sourceOrientation).multiply(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.1),
    );
    const result = solveArmTarget({
      rest: fixture.rest,
      rotations: base,
      chain,
      // The sampler owns the measured frame; the arm tip has no orientation.
      tip: armTip(fixture.rest, base, chain, before.position),
      target: {
        position: before.position,
        orientation: [desired.x, desired.y, desired.z, desired.w],
      },
      effector: (rotations) => {
        const frame = handFrame(
          fixture.recipe,
          fixture.evaluation,
          rotations,
          fixture.world,
          "figure",
        );
        return { position: frame.position, orientation: orientation(frame) };
      },
      tolerance: 0.01,
      orientationTolerance: 0.04,
    });
    expect(result.status, JSON.stringify(result)).toBe("reached");
    expect(result.orientationError).toBeLessThanOrEqual(0.04);
    expect(result.rotations[wrist * 4 + 3]).not.toBe(base[wrist * 4 + 3]);
  });

  it("falls back to its oriented tip when an effector samples position only", () => {
    const fixture = adult();
    const chain = armChain(fixture.rest, "R");
    const before = handFrame(fixture.recipe, fixture.evaluation, base, fixture.world, "figure");
    const sourceOrientation = orientation(before);
    const desired = new Quaternion(...sourceOrientation).multiply(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.1),
    );
    const result = solveArmTarget({
      rest: fixture.rest,
      rotations: base,
      chain,
      tip: armTip(fixture.rest, base, chain, before.position, sourceOrientation),
      target: {
        position: before.position,
        orientation: [desired.x, desired.y, desired.z, desired.w],
      },
      effector: (rotations) => ({
        position: handFrame(fixture.recipe, fixture.evaluation, rotations, fixture.world, "figure")
          .position,
      }),
      tolerance: 0.01,
      orientationTolerance: 0.04,
    });
    expect(result.status, JSON.stringify(result)).toBe("reached");
    expect(result.orientationError).toBeLessThanOrEqual(0.04);
  });

  it("uses a measured skinned orientation over a concurrent rigid tip", () => {
    const fixture = adult();
    const chain = armChain(fixture.rest, "R");
    const before = handFrame(fixture.recipe, fixture.evaluation, base, fixture.world, "figure");
    const measured = new Quaternion(...orientation(before)).multiply(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.1),
    );
    const rigidTip = new Quaternion(...orientation(before)).multiply(
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.1),
    );
    const result = solveArmTarget({
      rest: fixture.rest,
      rotations: base,
      chain,
      tip: armTip(fixture.rest, base, chain, before.position, [
        rigidTip.x,
        rigidTip.y,
        rigidTip.z,
        rigidTip.w,
      ]),
      target: {
        position: before.position,
        orientation: [measured.x, measured.y, measured.z, measured.w],
      },
      effector: (rotations) => {
        const frame = handFrame(
          fixture.recipe,
          fixture.evaluation,
          rotations,
          fixture.world,
          "figure",
        );
        return { position: frame.position, orientation: orientation(frame) };
      },
      tolerance: 0.01,
      orientationTolerance: 0.04,
    });
    expect(result.status, JSON.stringify(result)).toBe("reached");
    expect(result.orientationError).toBeLessThanOrEqual(0.04);
  });

  it("reports a reached measured hand frame even when its rigid-tip annulus is only diagnostic", () => {
    const fixture = adult();
    const chain = armChain(fixture.rest, "R");
    const before = handFrame(fixture.recipe, fixture.evaluation, base, fixture.world, "figure");
    const target: [number, number, number] = [
      before.position[0] + 2,
      before.position[1],
      before.position[2],
    ];
    const result = solveArmTarget({
      rest: fixture.rest,
      rotations: base,
      chain,
      tip: armTip(fixture.rest, base, chain, before.position),
      target: { position: target },
      effector: () => ({ position: target }),
      tolerance: 0.001,
    });
    expect(result.geometricallyReachable).toBe(false);
    expect(result.status).toBe("reached");
    expect(result.reason).toBe("reached");
  });

  it("reapplies wrist orientation after ancestors refine a displaced contact", () => {
    const fixture = adult();
    const before = handFrame(fixture.recipe, fixture.evaluation, base, fixture.world, "figure");
    const desired = new Quaternion(...orientation(before)).multiply(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.1),
    );
    const result = solveActualHand({
      ...fixture,
      target: [before.position[0] + 0.04, before.position[1] + 0.02, before.position[2] - 0.04],
      orientation: [desired.x, desired.y, desired.z, desired.w],
      orientationTolerance: 0.05,
    });
    expect(result.status, JSON.stringify(result)).toBe("reached");
    expect(result.orientationError).toBeLessThanOrEqual(0.05);
  });

  it("keeps non-arm source rotations byte-identical at partial weight", () => {
    const fixture = adult();
    const chain = armChain(fixture.rest, "R");
    const source = Float32Array.from(base);
    const head = fixture.rest.names.indexOf("head");
    source[head * 4 + 3] = 2;
    const before = handFrame(fixture.recipe, fixture.evaluation, source, fixture.world, "figure");
    const result = solveArmTarget({
      rest: fixture.rest,
      rotations: source,
      chain,
      tip: armTip(fixture.rest, source, chain, before.position),
      target: { position: [before.position[0] + 0.04, before.position[1], before.position[2]] },
      weight: 0,
    });
    expect(result.rotations[head * 4 + 3]).toBe(2);
    expect([...result.rotations.slice(head * 4, head * 4 + 4)]).toEqual([
      ...source.slice(head * 4, head * 4 + 4),
    ]);
  });

  it("keeps the elbow on the declared pole side for nearby rendered-hand targets", () => {
    const fixture = adult();
    const chain = armChain(fixture.rest, "R");
    const before = handFrame(fixture.recipe, fixture.evaluation, base, fixture.world, "figure");
    const pole = point(posedBones(fixture.rest, base).heads, chain[3] as number);
    const targetA: [number, number, number] = [
      before.position[0] + 0.06,
      before.position[1] + 0.02,
      before.position[2] - 0.05,
    ];
    const targetB: [number, number, number] = [targetA[0] + 0.01, targetA[1], targetA[2]];
    const a = solveActualHand({ ...fixture, target: targetA, pole });
    const b = solveActualHand({ ...fixture, target: targetB, pole });
    expect(a.status, JSON.stringify({ distance: a.distance })).toBe("reached");
    expect(b.status, JSON.stringify({ distance: b.distance })).toBe("reached");
    const sideA = elbowSide(fixture.rest, a.rotations, chain, targetA, pole);
    const sideB = elbowSide(fixture.rest, b.rotations, chain, targetB, pole);
    expect(sideA).toBeGreaterThan(0);
    expect(sideB).toBeGreaterThan(0);
    expect(Math.sign(sideA)).toBe(Math.sign(sideB));
  });

  it("keeps contact when an antipodal pole reverses the elbow side", () => {
    const fixture = adult();
    const chain = armChain(fixture.rest, "R");
    const before = handFrame(fixture.recipe, fixture.evaluation, base, fixture.world, "figure");
    const heads = posedBones(fixture.rest, base).heads;
    const root = point(heads, chain[0] as number);
    const elbow = point(heads, chain[3] as number);
    const axis: [number, number, number] = [
      before.position[0] - root[0],
      before.position[1] - root[1],
      before.position[2] - root[2],
    ];
    const axisLength = Math.hypot(...axis);
    const elbowOffset: [number, number, number] = [
      elbow[0] - root[0],
      elbow[1] - root[1],
      elbow[2] - root[2],
    ];
    const along =
      (elbowOffset[0] * axis[0] + elbowOffset[1] * axis[1] + elbowOffset[2] * axis[2]) /
      (axisLength * axisLength);
    const projected: [number, number, number] = [
      elbowOffset[0] - axis[0] * along,
      elbowOffset[1] - axis[1] * along,
      elbowOffset[2] - axis[2] * along,
    ];
    const oppositePole: [number, number, number] = [
      root[0] - projected[0],
      root[1] - projected[1],
      root[2] - projected[2],
    ];
    const result = solveActualHand({ ...fixture, target: before.position, pole: oppositePole });
    expect(result.status, JSON.stringify(result)).toBe("reached");
    expect(result.distance).toBeLessThanOrEqual(0.01);
    expect(
      elbowSide(fixture.rest, result.rotations, chain, before.position, oppositePole),
    ).toBeGreaterThan(0);
  });

  it("rejects an orientation request without a measurable orientation frame", () => {
    const fixture = adult();
    const chain = armChain(fixture.rest, "R");
    const before = handFrame(fixture.recipe, fixture.evaluation, base, fixture.world, "figure");
    const tip = armTip(fixture.rest, base, chain, before.position);
    expect(() =>
      solveArmTarget({
        rest: fixture.rest,
        rotations: base,
        chain,
        tip,
        target: { position: before.position, orientation: [0, 0, 0, 1] },
        tolerance: 0.01,
      }),
    ).toThrow(RangeError);

    const unavailable = solveArmTarget({
      rest: fixture.rest,
      rotations: base,
      chain,
      tip,
      target: { position: before.position, orientation: [0, 0, 0, 1] },
      effector: () => ({ position: before.position }),
      tolerance: 0.01,
    });
    expect(unavailable.status).toBe("unreached");
    expect(unavailable.reason).toBe("orientation-unavailable");

    expect(() =>
      solveArmTarget({
        rest: fixture.rest,
        rotations: base,
        chain,
        tip: { ...tip, position: [Number.POSITIVE_INFINITY, 0, 0] },
        target: { position: before.position },
      }),
    ).toThrow(RangeError);
    expect(() =>
      solveArmTarget({
        rest: fixture.rest,
        rotations: base,
        chain,
        tip,
        target: { position: before.position, orientation: [0, 0, 0, 0] },
      }),
    ).toThrow(RangeError);
    expect(() =>
      solveArmTarget({
        rest: fixture.rest,
        rotations: base,
        chain,
        tip,
        target: { position: before.position },
        pole: [0, Number.NaN, 0],
      }),
    ).toThrow(RangeError);
    expect(() =>
      solveArmTarget({
        rest: fixture.rest,
        rotations: base,
        chain,
        tip,
        target: { position: before.position },
        orientationTolerance: Number.NaN,
      }),
    ).toThrow(RangeError);
  });

  it("rejects invalid target data and overlapping output views", () => {
    const fixture = adult();
    const chain = armChain(fixture.rest, "R");
    const before = handFrame(fixture.recipe, fixture.evaluation, base, fixture.world, "figure");
    const tip = armTip(fixture.rest, base, chain, before.position);
    expect(() =>
      solveArmTarget({
        rest: fixture.rest,
        rotations: base,
        chain,
        tip,
        target: { position: [Number.NaN, 0, 0] },
      }),
    ).toThrow(RangeError);

    const storage = new Float32Array(base.length + 1);
    storage.set(base);
    expect(() =>
      solveArmTarget({
        rest: fixture.rest,
        rotations: storage.subarray(0, base.length),
        out: storage.subarray(1),
        chain,
        tip,
        target: { position: before.position },
      }),
    ).toThrow(RangeError);

    const sourceHeads = Float32Array.from(fixture.rest.heads);
    const shared = new Float32Array(base.length);
    const guardedRest = { ...fixture.rest, heads: shared.subarray(0, sourceHeads.length) };
    guardedRest.heads.set(sourceHeads);
    shared.fill(-17, sourceHeads.length);
    const overlappingBefore = Float32Array.from(shared);
    expect(() =>
      solveArmTarget({
        rest: guardedRest,
        rotations: base,
        out: shared,
        chain: armChain(guardedRest, "R"),
        tip: armTip(guardedRest, base, armChain(guardedRest, "R"), before.position),
        target: { position: before.position },
      }),
    ).toThrow(RangeError);
    expect(guardedRest.heads).toEqual(sourceHeads);
    expect(shared).toEqual(overlappingBefore);

    const oversized = new Float32Array(base.length + 1).fill(-23);
    const restBefore = Float32Array.from(fixture.rest.heads);
    expect(() =>
      solveArmTarget({
        rest: fixture.rest,
        rotations: base,
        out: oversized,
        chain,
        tip,
        target: { position: before.position },
      }),
    ).toThrow(RangeError);
    expect(fixture.rest.heads).toEqual(restBefore);
    expect(oversized).toEqual(new Float32Array(base.length + 1).fill(-23));

    expect(() =>
      solveArmTarget({
        rest: fixture.rest,
        rotations: base,
        chain,
        tip,
        target: { position: before.position },
        effector: () => ({ position: [Number.NaN, 0, 0] }),
      }),
    ).toThrow(RangeError);
  });

  it("composes fallback tip orientation into the figure frame", () => {
    const fixture = adult();
    const chain = armChain(fixture.rest, "R");
    const wrist = chain.at(-1) as number;
    const rotations = Float32Array.from(base);
    rotations.set([0, Math.sin(0.3), 0, Math.cos(0.3)], (chain[0] as number) * 4);
    const pose = posedBones(fixture.rest, rotations);
    const position = point(pose.heads, wrist);
    const figureOrientation: [number, number, number, number] = [
      pose.world[wrist * 4] as number,
      pose.world[wrist * 4 + 1] as number,
      pose.world[wrist * 4 + 2] as number,
      pose.world[wrist * 4 + 3] as number,
    ];
    const result = solveArmTarget({
      rest: fixture.rest,
      rotations,
      chain,
      tip: armTip(fixture.rest, rotations, chain, position, figureOrientation),
      target: { position, orientation: figureOrientation },
      tolerance: 0.001,
      orientationTolerance: 0.001,
    });
    expect(result.status).toBe("reached");
    expect(result.orientationError).toBeLessThanOrEqual(0.001);
  });
});
