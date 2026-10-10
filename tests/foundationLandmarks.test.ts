/**
 * The foundation's landmarks (src/foundation/landmarks.ts, docs/FOUNDATION.md,
 * "What the foundation gives layers"): named places evaluated on the posed,
 * morphed surface as drawn, each a position, the skin's outward normal there
 * and a tangent frame that follows the skin. Garments, affordances and sheet
 * cameras anchor to them, so they must sit where their names say on every
 * body, follow every pose, and agree between the core and adult forms.
 */
import { describe, expect, it } from "vitest";
import { BATTERY_CROSS, batteryBody } from "../src/foundation/battery.ts";
import {
  JOINT_LANDMARKS,
  LANDMARK_IDS,
  type LandmarkFrame,
  type LandmarkId,
  landmarks,
  landmarkVertices,
  SURFACE_LANDMARKS,
} from "../src/foundation/landmarks.ts";
import { REST_POSE, SMOKE_POSES } from "../src/foundation/permutations.ts";
import { posedSurface } from "../src/foundation/posed.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { loadFixtureAssets } from "./fixtures.ts";

type V = readonly [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (a: V) => Math.hypot(a[0], a[1], a[2]);

const core = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
const adult = new HumanoidModel(loadFixtureAssets(true), { subdivision: 1 });
const bodies = BATTERY_CROSS.bodies.map((name) => batteryBody(name));
const recipeOf = (b: (typeof bodies)[number]) => createRecipe({ macros: { ...b.macros } });

describe("landmarks", { timeout: 300_000 }, () => {
  const rest = bodies.map((b) => ({
    name: b.name,
    frames: landmarks(core, posedSurface(core, recipeOf(b), REST_POSE)),
  }));

  it("names every landmark once: the surface's and the joints'", () => {
    expect(new Set(LANDMARK_IDS).size).toBe(LANDMARK_IDS.length);
    expect([...SURFACE_LANDMARKS, ...JOINT_LANDMARKS].sort()).toEqual([...LANDMARK_IDS].sort());
  });

  it("gives each a finite position and an orthonormal frame, at rest and in every pose", () => {
    const posed = SMOKE_POSES.map((pose) => ({
      name: `f-heavy ${pose}`,
      frames: landmarks(core, posedSurface(core, recipeOf(batteryBody("f-heavy")), pose)),
    }));
    for (const { name, frames } of [...rest, ...posed])
      for (const id of LANDMARK_IDS) {
        const f = frames[id] as LandmarkFrame;
        const label = `${name} ${id}`;
        for (const v of [f.position, f.normal, f.tangent, f.bitangent])
          expect(v.every(Number.isFinite), label).toBe(true);
        for (const v of [f.normal, f.tangent, f.bitangent])
          expect(length(v), label).toBeCloseTo(1, 6);
        expect(dot(f.normal, f.tangent), label).toBeCloseTo(0, 6);
        expect(dot(f.normal, f.bitangent), label).toBeCloseTo(0, 6);
        expect(dot(f.tangent, f.bitangent), label).toBeCloseTo(0, 6);
      }
  });

  it("puts each surface landmark on a vertex of the surface as drawn, facing out along its normal, in every pose", () => {
    for (const [b, pose] of [
      ...bodies.map((x) => [x, REST_POSE] as const),
      ...SMOKE_POSES.map((p) => [batteryBody("m-heavy"), p] as const),
    ]) {
      const body = posedSurface(core, recipeOf(b), pose);
      const frames = landmarks(core, body);
      for (const id of SURFACE_LANDMARKS) {
        const f = frames[id];
        let nearest = Number.POSITIVE_INFINITY;
        let at = -1;
        for (let r = 0; r < body.vertexCount; r++) {
          const d = Math.hypot(
            (body.positions[r * 3] as number) - f.position[0],
            (body.positions[r * 3 + 1] as number) - f.position[1],
            (body.positions[r * 3 + 2] as number) - f.position[2],
          );
          if (d < nearest) {
            nearest = d;
            at = r;
          }
        }
        expect(nearest, `${b.name} ${pose} ${id}`).toBeLessThan(1e-6);
        const n: V = [
          body.normals[at * 3] as number,
          body.normals[at * 3 + 1] as number,
          body.normals[at * 3 + 2] as number,
        ];
        expect(dot(f.normal, n) / length(n), `${b.name} ${pose} ${id}`).toBeGreaterThan(0.999);
      }
    }
  });

  it("is its base vertex's own point of the surface: the subdivided vertex, within millimetres of the control vertex", () => {
    const bases = landmarkVertices(core.assets);
    for (const b of bodies) {
      const body = posedSurface(core, recipeOf(b), REST_POSE);
      const frames = landmarks(core, body);
      for (const id of SURFACE_LANDMARKS) {
        const v = bases[id];
        const control: V = [
          body.control[v * 3] as number,
          body.control[v * 3 + 1] as number,
          body.control[v * 3 + 2] as number,
        ];
        // Smoothing moves a vertex a few millimetres at most; a neighbour is a centimetre away.
        expect(length(sub(frames[id].position, control)), `${b.name} ${id}`).toBeLessThan(0.004);
      }
    }
  });

  it("mirrors left and right on the midline at rest", () => {
    const pairs = LANDMARK_IDS.filter((id) => id.endsWith(".L")).map(
      (id) => [id, id.replace(/\.L$/, ".R") as LandmarkId] as const,
    );
    expect(pairs.length).toBeGreaterThan(0);
    for (const { name, frames } of rest)
      for (const [l, r] of pairs) {
        const a = frames[l].position;
        const b = frames[r].position;
        expect(a[0], `${name} ${l}`).toBeGreaterThan(0);
        expect(a[0] + b[0], `${name} ${l}`).toBeCloseTo(0, 3);
        expect(a[1] - b[1], `${name} ${l}`).toBeCloseTo(0, 3);
        expect(a[2] - b[2], `${name} ${l}`).toBeCloseTo(0, 3);
      }
    const midline: LandmarkId[] = [
      "navel",
      "sternum-notch",
      "pubic-point",
      "chin",
      "nose-tip",
      "crown",
    ];
    for (const { name, frames } of rest)
      for (const id of midline)
        expect(Math.abs(frames[id].position[0]), `${name} ${id}`).toBeLessThan(1e-3);
  });

  it("orders the body's landmarks from the crown down, and the face's forward, at rest", () => {
    for (const { name, frames } of rest) {
      const y = (id: LandmarkId) => frames[id].position[1];
      const z = (id: LandmarkId) => frames[id].position[2];
      const down: LandmarkId[] = [
        "crown",
        "nose-tip",
        "chin",
        "sternum-notch",
        "nipple.L",
        "navel",
        "pubic-point",
        "knee.L",
        "ankle.L",
      ];
      for (let i = 1; i < down.length; i++)
        expect(
          y(down[i - 1] as LandmarkId),
          `${name}: ${down[i - 1]} above ${down[i]}`,
        ).toBeGreaterThan(y(down[i] as LandmarkId));
      expect(z("nose-tip"), name).toBeGreaterThan(z("chin"));
      expect(y("upper-lip"), name).toBeGreaterThan(y("lower-lip"));
      expect(y("shoulder.L"), name).toBeGreaterThan(y("elbow.L"));
      expect(y("elbow.L"), name).toBeGreaterThan(y("wrist.L"));
      expect(y("hip.L"), name).toBeGreaterThan(y("knee.L"));
      // The front of the body faces forward (+z) at the nipples, navel, sternum and pubis.
      for (const id of ["nipple.L", "navel", "sternum-notch", "pubic-point"] as const)
        expect(frames[id].normal[2], `${name} ${id}`).toBeGreaterThan(0.5);
      expect(frames.crown.normal[1], name).toBeGreaterThan(0.8);
      // A joint is framed by the limb that reaches it, its normal the figure's forward: the
      // ankle by the shin (the foot runs forward from it), the wrist by the forearm.
      for (const id of ["knee.L", "ankle.L"] as const)
        expect(frames[id].normal[2], `${name} ${id}`).toBeGreaterThan(0.9);
      // The forearm at rest leans a little forward, so its square to forward does too.
      for (const id of ["elbow.L", "wrist.L"] as const)
        expect(frames[id].normal[2], `${name} ${id}`).toBeGreaterThan(0.6);
      expect(frames["ankle.L"].tangent[1], name).toBeLessThan(-0.9);
      expect(frames["wrist.L"].tangent[0], name).toBeGreaterThan(0.3);
      // The ear lobes are out at the sides of the head and behind the face.
      for (const id of ["ear-lobe.L", "ear-lobe.R"] as const) {
        expect(Math.abs(frames[id].position[0]), `${name} ${id}`).toBeGreaterThan(0.04);
        expect(z(id), `${name} ${id}`).toBeLessThan(z("nose-tip") - 0.04);
        expect(y(id), `${name} ${id}`).toBeLessThan(y("crown"));
        expect(y(id), `${name} ${id}`).toBeGreaterThan(y("sternum-notch"));
      }
    }
  });

  it("follows the pose: the joints' landmarks keep their bones' lengths, and the hands rise overhead", () => {
    const b = batteryBody("f-average");
    const at = (pose: string) => landmarks(core, posedSurface(core, recipeOf(b), pose));
    const span = (f: Record<LandmarkId, LandmarkFrame>, a: LandmarkId, c: LandmarkId) =>
      length(sub(f[a].position, f[c].position));
    const still = at(REST_POSE);
    for (const pose of SMOKE_POSES) {
      const f = at(pose);
      for (const [a, c] of [
        ["shoulder.L", "elbow.L"],
        ["elbow.L", "wrist.L"],
        ["hip.L", "knee.L"],
        ["knee.L", "ankle.L"],
      ] as const)
        expect(span(f, a, c), `${pose} ${a}-${c}`).toBeCloseTo(span(still, a, c), 5);
    }
    const overhead = at("overhead");
    expect(overhead["wrist.L"].position[1]).toBeGreaterThan(overhead.crown.position[1]);
    // The surface landmarks ride the skin: the nipple stays on the chest, near the sternum.
    const seated = at("seated");
    expect(span(seated, "nipple.L", "sternum-notch")).toBeCloseTo(
      span(still, "nipple.L", "sternum-notch"),
      2,
    );
  });

  it("is the same in both forms of an adult away from the anatomy (invariant 7)", () => {
    for (const b of bodies.filter((x) => x.macros.age >= 18)) {
      const recipe = recipeOf(b);
      const a = landmarks(core, posedSurface(core, recipe, REST_POSE));
      const c = landmarks(adult, posedSurface(adult, recipe, REST_POSE));
      for (const id of LANDMARK_IDS) {
        // The pubic point sits on the mound the adult surface refines; it moves with the anatomy.
        if (id === "pubic-point") continue;
        expect(length(sub(a[id].position, c[id].position)), `${b.name} ${id}`).toBeLessThan(1e-4);
      }
    }
  });
});
