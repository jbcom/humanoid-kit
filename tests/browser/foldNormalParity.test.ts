/** GPU readback of the normal installed by applyDualSkinning, before lighting. */
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  FloatType,
  Matrix4,
  MeshNormalMaterial,
  OrthographicCamera,
  Scene,
  Skeleton,
  SkinnedMesh,
  WebGLRenderTarget,
} from "three";
import { describe, expect, it } from "vitest";
import {
  applyDualSkinning,
  DualBones,
  FOLD_SLOTS_ATTRIBUTE,
  makeFoldSlots,
  setSkinAttributes,
  writeFoldSlots,
} from "../../src/render/dualSkinning.ts";
import { skinNormalAt } from "../../src/rig/dual.ts";
import { toHalf } from "../../src/rig/half.ts";
import { HIP_FOLD, hipRotation } from "../../src/rig/hipFold.ts";
import { rowTexels, type SurfaceFold } from "../../src/rig/jointFold.ts";
import { IDENTITY_POSE, restBonesFrom } from "../../src/rig/pose.ts";
import { createTestRenderer } from "./gl.ts";

const renderer = createTestRenderer({ antialias: false });
// A separate flexed hip activates the fold; the two influenced bones keep an
// exact, pose-independent 1/2 DQ share (neither is a swing-share limb).
const names = ["root", "blend", "upperleg01.L", "upperleg01.R"];
const rest = restBonesFrom(
  names,
  Int16Array.from([-1, 0, 0, 0]),
  new Float32Array(names.length * 3),
);

function normalReadback({
  fold = true,
  slot = true,
  blend = 1,
  emptyWeights = false,
  identity = false,
  correction = [0.25, 0, 0],
}: {
  fold?: boolean;
  slot?: boolean;
  blend?: number;
  emptyWeights?: boolean;
  identity?: boolean;
  correction?: readonly number[];
} = {}): { gpu: number[]; cpu: number[] } {
  const rotations = IDENTITY_POSE(names.length);
  if (!identity) rotations.set([Math.sqrt(0.75), 0, 0, 0.5], 4);
  rotations.set(hipRotation(90, 0, 1), 8);
  const bones = new DualBones(names.length, 0.5);
  const data = new Float32Array(rowTexels(HIP_FOLD) * 4);
  for (let key = 0; key < HIP_FOLD.keys * HIP_FOLD.openings; key++)
    data.set(correction, key * 8 + 4);
  data[3] = 1; // Left side, whose hip is flexed.
  const surface: SurfaceFold = {
    joint: HIP_FOLD,
    rows: 1,
    slot: Float32Array.of(0),
    data: Uint16Array.from(data, toHalf),
  };
  bones.setFolds([surface]);
  bones.foldBlend.value = blend;
  bones.update(rest, rotations);

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(Float32Array.of(-1, -1, 0, 3, -1, 0, -1, 3, 0), 3),
  );
  geometry.setAttribute(
    "normal",
    new BufferAttribute(Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1), 3),
  );
  const index = Uint16Array.from({ length: 24 }, (_, i) => (i % 8 === 1 ? 1 : 0));
  const weight = Float32Array.from({ length: 24 }, (_, i) =>
    !emptyWeights && i % 8 < 2 ? 0.5 : 0,
  );
  setSkinAttributes(geometry, index, weight);
  const slots = makeFoldSlots(3);
  if (slot) writeFoldSlots(slots, HIP_FOLD, [0, 0, 0]);
  geometry.setAttribute(FOLD_SLOTS_ATTRIBUTE, slots);

  const material = new MeshNormalMaterial();
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec3 measuredNormal;\n${shader.vertexShader}`
      .replace(
        "#include <skinnormal_vertex>",
        "#include <skinnormal_vertex>\nmeasuredNormal = objectNormal;",
      )
      // Fix only the raster footprint: the production skinning chunks execute
      // with real attributes, matrices and uploaded fold/bone textures.
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\ngl_Position = vec4(position.xy, 0.0, 1.0);",
      );
    shader.fragmentShader = `varying vec3 measuredNormal;
      void main() { gl_FragColor = vec4(measuredNormal, 1.0); }`;
  };
  applyDualSkinning(material, bones, fold);
  const mesh = new SkinnedMesh(geometry, material);
  const joints = names.map(() => new Bone());
  for (let b = 1; b < joints.length; b++) joints[0]?.add(joints[b] as Bone);
  const skeleton = new Skeleton(joints);
  mesh.bind(skeleton, new Matrix4());
  joints.forEach((joint, b) => {
    joint.quaternion.fromArray(rotations, b * 4);
  });
  const scene = new Scene();
  scene.add(mesh, joints[0] as Bone);
  mesh.frustumCulled = false;
  const target = new WebGLRenderTarget(1, 1, { type: FloatType, depthBuffer: false });
  try {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0, 0);
    renderer.clear();
    renderer.render(scene, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
    const pixel = new Float32Array(4);
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
    expect(pixel[3], "the shader covered the measured pixel").toBe(1);
    const gpu = Array.from(pixel.subarray(0, 3));
    expect(gpu.every(Number.isFinite), "finite GPU normal").toBe(true);
    const cpu = [0, 0, 0];
    const pose = bones.pose();
    if (!pose) throw new Error("the fixture has no CPU pose");
    skinNormalAt(pose, index, weight, 0, 0, 0, 1, cpu, 0, fold && slot ? bones.skinFolds() : []);
    return { gpu, cpu };
  } finally {
    renderer.setRenderTarget(null);
    target.dispose();
    skeleton.dispose();
    geometry.dispose();
    material.dispose();
    bones.dispose();
  }
}

describe("the patched production shader's fold normal", () => {
  it.each([1, 0.25, 0])(
    "normalizes the mixed base before a nonparallel fold at blend %s",
    (blend) => {
      const { gpu, cpu } = normalReadback({ blend });
      // Equal identity/120-degree rotations give an LBS length of 1/2 and a
      // DQ length of 1. Their 1/2 mix has length 3/4, pointing 60 degrees about X.
      // The correction is on X, perpendicular to that base normal.
      const length = Math.hypot(1, 0.25 * blend);
      const expected = [(0.25 * blend) / length, -Math.sqrt(0.75) / length, 0.5 / length];
      expected.forEach((want, k) => {
        expect(cpu[k], `CPU component ${k}`).toBeCloseTo(want, 5);
        expect(gpu[k], `GPU component ${k}`).toBeCloseTo(want, 5);
      });
    },
  );

  it.each([{ fold: false }, { slot: false }])(
    "preserves the unnormalized no-fold output: %j",
    (options) => {
      const { gpu, cpu } = normalReadback(options);
      const raw = [0, -Math.sqrt(0.75) * 0.75, 0.375];
      raw.forEach((want, k) => {
        expect(gpu[k]).toBeCloseTo(want, 5);
        expect((gpu[k] as number) / 0.75).toBeCloseTo(cpu[k] as number, 5);
      });
    },
  );

  it.each([
    { emptyWeights: true },
    { emptyWeights: true, correction: [0, 0, 0] },
    { identity: true, correction: [0, 0, -1] },
  ])("matches the CPU's zero-length fallback: %j", (options) => {
    const { gpu, cpu } = normalReadback(options);
    const expected = options.correction ? [0, 0, 0] : [1, 0, 0];
    expected.forEach((want, k) => {
      expect(cpu[k]).toBe(want);
      expect(gpu[k]).toBeCloseTo(want, 5);
    });
  });
});
