/**
 * The renderer's skinning on the GPU (src/render/dualSkinning.ts) against its
 * CPU reference (src/rig/dual.ts): the shader's dual quaternion blend vertex by
 * vertex, and a whole skinned mesh as drawn, with the share of each scheme
 * mixed as the reference mixes them.
 */
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  FloatType,
  GLSL3,
  Matrix4,
  Mesh,
  MeshNormalMaterial,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Skeleton,
  SkinnedMesh,
  UnsignedByteType,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, describe, expect, it } from "vitest";
import * as pkg from "../../src/react/index.ts";
import {
  applyDualSkinning,
  DUAL_BONES_UNIFORM,
  DUAL_SKINNING_FUNCTIONS,
  DualBones,
  FOLD_BLEND_UNIFORM,
  FOLD_FUNCTIONS,
  FOLD_UNIFORM,
  followDualSkinning,
  ROOT_UNIFORM,
} from "../../src/render/dualSkinning.ts";
import {
  DUAL_TEXELS,
  skinNormalsBlended,
  skinPose,
  skinPositionsBlended,
  skinVertex,
} from "../../src/rig/dual.ts";
import { toHalf } from "../../src/rig/half.ts";
import {
  addFold,
  addFoldNormal,
  FOLD_KEYS,
  FOLD_OPENINGS,
  FOLD_ROW_TEXELS,
  foldAngles,
  HIP_FOLD,
  type HipFold,
  hipFlexion,
  hipRotation,
  renderFold,
  type SurfaceFold,
} from "../../src/rig/hipFold.ts";
import { type BoneRotations, restBonesFrom } from "../../src/rig/pose.ts";
import { rotate } from "../../src/rig/quat.ts";

const renderer = new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
afterAll(() => renderer.dispose());

/** A small deterministic generator, so a failure repeats. */
function random(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** A branching skeleton: a spine of four bones with a side bone off the second. */
const NAMES = ["root", "spine", "chest", "head", "arm"];
const PARENTS = Int16Array.from([-1, 0, 1, 2, 1]);
const HEADS = Float32Array.from([0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 1, 1.5, 0]);
const rest = restBonesFrom(NAMES, PARENTS, HEADS);
/** How much of dual quaternion skinning each bone asks for. */
const SHARE = [0, 1, 0.5, 0.25, 1];

/** A unit quaternion turning `degrees` about (x, y, z). */
function turn(x: number, y: number, z: number, degrees: number): number[] {
  const h = (degrees * Math.PI) / 360;
  const s = Math.sin(h) / Math.hypot(x, y, z);
  return [x * s, y * s, z * s, Math.cos(h)];
}

function pose(turns: [number, number[]][]): BoneRotations {
  const r = new Float32Array(NAMES.length * 4);
  for (let b = 0; b < NAMES.length; b++) r[b * 4 + 3] = 1;
  for (const [bone, q] of turns) r.set(q, bone * 4);
  return r;
}

const POSES: [string, BoneRotations][] = [
  ["rest", pose([])],
  [
    "bent and twisted",
    pose([
      [1, turn(0, 0, 1, 70)],
      [2, turn(0, 1, 0, 150)],
      [4, turn(1, 0, 0, 40)],
    ]),
  ],
  [
    "folded",
    pose([
      [1, turn(1, 0.2, 0, 120)],
      [3, turn(0, 1, 0.3, 170)],
    ]),
  ],
];

describe("the vertex shader's dual quaternion blend", () => {
  it("finds each vertex's motion and share exactly as the CPU reference does", () => {
    const rand = random(7);
    const count = 160;
    const positions = new Float32Array(count * 3).map(() => rand() * 4 - 2);
    const normals = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      const n = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
      const len = Math.hypot(...(n as [number, number, number]));
      normals.set(
        n.map((x) => x / len),
        v * 3,
      );
    }
    // One to four bones per vertex, in any order (the first with weight is the pivot).
    const skinIndex = new Float32Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    for (let v = 0; v < count; v++) {
      const used = 1 + Math.floor(rand() * 4);
      let total = 0;
      for (let k = 0; k < 4; k++) {
        skinIndex[v * 4 + k] = Math.floor(rand() * NAMES.length);
        skinWeight[v * 4 + k] = k < used ? 0.1 + rand() : 0;
        total += skinWeight[v * 4 + k] as number;
      }
      for (let k = 0; k < 4; k++) skinWeight[v * 4 + k] = (skinWeight[v * 4 + k] as number) / total;
    }
    const texture = (data: Float32Array, per: 3 | 4) => {
      const padded = new Float32Array(count * 4);
      for (let v = 0; v < count; v++)
        for (let k = 0; k < per; k++) padded[v * 4 + k] = data[v * per + k] as number;
      const t = new DataTexture(padded, count, 1, RGBAFormat, FloatType);
      t.minFilter = NearestFilter;
      t.magFilter = NearestFilter;
      t.needsUpdate = true;
      return t;
    };
    const target = new WebGLRenderTarget(count, 1, { type: FloatType, depthBuffer: false });

    for (const [name, rotations] of POSES) {
      const dual = new DualBones(NAMES.length, SHARE);
      dual.update(rest, rotations);
      const read = (mode: 0 | 1 | 2): Float32Array => {
        const material = new ShaderMaterial({
          glslVersion: GLSL3,
          uniforms: {
            [DUAL_BONES_UNIFORM]: { value: dual.texture },
            tPosition: { value: texture(positions, 3) },
            tNormal: { value: texture(normals, 3) },
            tIndex: { value: texture(skinIndex, 4) },
            tWeight: { value: texture(skinWeight, 4) },
            uMode: { value: mode },
          },
          vertexShader: "void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }",
          fragmentShader: `
            #define USE_SKINNING
            uniform highp sampler2D tPosition;
            uniform highp sampler2D tNormal;
            uniform highp sampler2D tIndex;
            uniform highp sampler2D tWeight;
            uniform int uMode;
            layout( location = 0 ) out highp vec4 outColor;
            ${DUAL_SKINNING_FUNCTIONS}
            void main() {
              ivec2 p = ivec2( gl_FragCoord.xy );
              vec4 q; vec3 t; float share;
              hkDualMotion( texelFetch( tIndex, p, 0 ), texelFetch( tWeight, p, 0 ), q, t, share );
              vec3 rest = uMode == 1 ? texelFetch( tNormal, p, 0 ).xyz : texelFetch( tPosition, p, 0 ).xyz;
              outColor = uMode == 2 ? vec4( share, 0.0, 0.0, 1.0 ) : vec4( uMode == 1 ? hkQRotate( q, rest ) : hkQRotate( q, rest ) + t, 1.0 );
            }`,
        });
        const scene = new Scene();
        scene.add(new Mesh(new PlaneGeometry(2, 2), material));
        renderer.setRenderTarget(target);
        renderer.render(scene, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
        const px = new Float32Array(count * 4);
        renderer.readRenderTargetPixels(target, 0, 0, count, 1, px);
        renderer.setRenderTarget(null);
        for (const u of Object.values(material.uniforms))
          (u.value as DataTexture | undefined)?.dispose?.();
        material.dispose();
        return px;
      };

      const cpuPose = skinPose(rest, rotations, 1);
      const gpuPosition = read(0);
      const gpuShare = read(2);
      const gpuNormal = read(1);
      const out: number[] = [0, 0, 0];
      let worst = 0;
      for (let v = 0; v < count; v++) {
        skinVertex(
          cpuPose,
          skinIndex as never,
          skinWeight,
          v,
          positions[v * 3] as number,
          positions[v * 3 + 1] as number,
          positions[v * 3 + 2] as number,
          out,
        );
        for (let k = 0; k < 3; k++)
          worst = Math.max(
            worst,
            Math.abs((gpuPosition[v * 4 + k] as number) - (out[k] as number)),
          );
        let share = 0;
        for (let k = 0; k < 4; k++)
          share +=
            (skinWeight[v * 4 + k] as number) * (SHARE[skinIndex[v * 4 + k] as number] as number);
        expect(gpuShare[v * 4], `${name}: share of vertex ${v}`).toBeCloseTo(share, 5);
      }
      expect(worst, `${name}: position`).toBeLessThan(2e-5);
      const cpuNormals = skinNormalsBlended(
        rest,
        rotations,
        normals,
        skinIndex as never,
        skinWeight,
        new Float32Array(count * 3),
        1,
      );
      for (let v = 0; v < count; v++)
        for (let k = 0; k < 3; k++)
          expect(gpuNormal[v * 4 + k], `${name}: normal ${v}.${k}`).toBeCloseTo(
            cpuNormals[v * 3 + k] as number,
            5,
          );
      dual.dispose();
    }
    target.dispose();
  });
});

/** Two thighs off a root, for the fold: the hips' flexions are what the fold is read at. */
const HIP_NAMES = ["root", "upperleg01.L", "upperleg01.R"];
const hipRest = restBonesFrom(
  HIP_NAMES,
  Int16Array.from([-1, 0, 0]),
  Float32Array.from([0, 1, 0, 0.1, 0.95, 0, -0.1, 0.95, 0]),
);
/**
 * The root turned `root`, the left hip flexed `left` degrees and opened
 * `leftOpening`, the right flexed `right` and opened `rightOpening` (`hipRotation`).
 */
function hipsPose(
  root: number[],
  left: number,
  right: number,
  leftOpening = 0,
  rightOpening = 0,
): BoneRotations {
  const r = new Float32Array(HIP_NAMES.length * 4);
  r.set(root, 0);
  r.set(hipRotation(left, leftOpening, 1), 4);
  r.set(hipRotation(right, rightOpening, -1), 8);
  return r;
}

describe("the vertex shader's hip fold", () => {
  it("reads each vertex's displacement and normal change at the flexion and opening of the hips on its side, turned with the root, exactly as the CPU reference does", () => {
    const rand = random(11);
    // More rows than a texture a row a line could hold on many GPUs (8192 on the render
    // host), and than an adult surface's fold has (14796 rows for the average figure,
    // 15200 for the heavy man), each row both openings wide.
    const rows = 16000;
    const count = 200;
    // Every key of every opening, per row.
    const K = FOLD_OPENINGS * FOLD_KEYS;
    const fold: HipFold = {
      vertices: Uint32Array.from({ length: rows }, (_, i) => i),
      slot: Int32Array.from({ length: rows }, (_, i) => i),
      vectors: new Float32Array(rows * K * 3).map(() => (rand() - 0.5) * 0.2),
      normals: new Float32Array(rows * K * 3).map(() => (rand() - 0.5) * 1.5),
      // The left hip's alone, the right's alone, and mixes of the two: in 1024ths, which a half float holds
      // exactly, so that the read against these unrounded values below measures the values' rounding alone.
      side: Float32Array.from({ length: rows }, (_, i) =>
        i < 2 ? i : Math.round(rand() * 1024) / 1024,
      ),
    };
    // The renderer's rows: per opening and key, the displacement's texel (x, y, z, 0) and the normal's; the side in the first's fourth place.
    const values = new Float32Array(rows * FOLD_ROW_TEXELS * 4);
    for (let i = 0; i < rows * K; i++) {
      values.set(fold.vectors.subarray(i * 3, i * 3 + 3), i * 8);
      values.set(fold.normals.subarray(i * 3, i * 3 + 3), i * 8 + 4);
    }
    for (let r = 0; r < rows; r++) values[r * FOLD_ROW_TEXELS * 4 + 3] = fold.side[r] as number;
    // Half floats, as the texture holds them; the CPU's fold (`renderFold`) reads the same halves.
    const surface: SurfaceFold = {
      slot: Float32Array.from({ length: rows }, (_, i) => i),
      rows,
      data: Uint16Array.from(values, toHalf),
    };
    const shown = renderFold(surface);
    const dual = new DualBones(HIP_NAMES.length, 0);
    dual.setFold(surface);
    // A row per vertex: the left hip's and the right's alone, the last row, and rows from every line between.
    const asked = new Float32Array(count * 4);
    for (let v = 0; v < count; v++)
      asked[v * 4] = v < 2 ? v : v === 2 ? rows - 1 : Math.floor(rand() * rows);
    const input = new DataTexture(asked, count, 1, RGBAFormat, FloatType);
    input.minFilter = NearestFilter;
    input.magFilter = NearestFilter;
    input.needsUpdate = true;
    const material = new ShaderMaterial({
      glslVersion: GLSL3,
      uniforms: {
        [DUAL_BONES_UNIFORM]: { value: dual.texture },
        [FOLD_UNIFORM]: dual.fold,
        [ROOT_UNIFORM]: { value: HIP_NAMES.length * DUAL_TEXELS },
        [FOLD_BLEND_UNIFORM]: dual.foldBlend,
        tAsked: { value: input },
        tPart: { value: 0 },
      },
      vertexShader: "void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }",
      fragmentShader: `
        #define USE_SKINNING
        uniform highp sampler2D tAsked;
        uniform int tPart;
        layout( location = 0 ) out highp vec4 outColor;
        ${DUAL_SKINNING_FUNCTIONS}
        ${FOLD_FUNCTIONS}
        void main() {
          vec4 a = texelFetch( tAsked, ivec2( gl_FragCoord.xy ), 0 );
          int slot = int( a.x + 0.5 );
          outColor = tPart == 2
            ? vec4( hkFoldAngles( slot ), 0.0, 1.0 )
            : vec4( tPart == 0 ? hkFoldDisplacement( a.x ) : hkFoldNormal( a.x ), 1.0 );
        }`,
    });
    const scene = new Scene();
    scene.add(new Mesh(new PlaneGeometry(2, 2), material));
    const target = new WebGLRenderTarget(count, 1, { type: FloatType, depthBuffer: false });
    const draw = (part: number) => {
      material.uniforms.tPart = { value: part };
      renderer.setRenderTarget(target);
      renderer.render(scene, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
      const px = new Float32Array(count * 4);
      renderer.readRenderTargetPixels(target, 0, 0, count, 1, px);
      renderer.setRenderTarget(null);
      return px;
    };
    // The root turned, so the displacement turns too; the hips flexed apart, from short of where the fold starts to past where it ends,
    // and opened apart, from drawn in to past the fold's opened keys.
    const root = turn(0.3, 1, 0.2, 70);
    let moved = 0;
    for (const [left, right, leftOpening, rightOpening] of [
      [120, 0, 0, 0],
      [-10, 75, 5, 12],
      [45, 133, 20, 31],
      [100, 100, -8, 10],
      [HIP_FOLD.to + 12, HIP_FOLD.from - 5, 15, 0],
    ] as const) {
      const rotations = hipsPose(root, left, right, leftOpening, rightOpening);
      dual.update(hipRest, rotations);
      const hips = hipFlexion(hipRest, rotations);
      expect(hips.left, `${left}°`).toBeCloseTo(left, 3);
      expect(hips.rightOpening, `${rightOpening}°`).toBeCloseTo(rightOpening, 3);
      // The angles each row is read at: the left hip's for side 1, the right's for side 0, and the greater flexion of the two, each weighed by its side, between.
      const angles = draw(2);
      for (let v = 0; v < count; v++) {
        const cpu = foldAngles(shown, asked[v * 4] as number, hips);
        expect(angles[v * 4], `${left}/${right}: vertex ${v}`).toBeCloseTo(
          cpu?.flexion as number,
          3,
        );
        expect(angles[v * 4 + 1], `${left}/${right}: vertex ${v}`).toBeCloseTo(
          cpu?.opening as number,
          3,
        );
      }
      // A row all the right's reads the right hip, all the left's the left (the other counts for nothing, as an unflexed hip does).
      expect(angles[0]).toBeCloseTo(Math.max(0, right), 2);
      expect(angles[4]).toBeCloseTo(Math.max(0, left), 2);
      // Whole, then half faded in, then not at all (the fold fades in when it arrives).
      for (const [part, read, blend] of [
        [0, addFold, 1],
        [1, addFoldNormal, 1],
        [0, addFold, 0.5],
        [1, addFoldNormal, 0.25],
        [0, addFold, 0],
      ] as const) {
        dual.foldBlend.value = blend;
        const px = draw(part);
        /** The GPU's read against the CPU's of `of` (the halves it draws, or the values before they were rounded). */
        const against = (of: HipFold) => {
          let worst = 0;
          for (let v = 0; v < count; v++) {
            const cpu = new Float32Array(3);
            const slot = asked[v * 4] as number;
            const at = foldAngles(of, slot, hips);
            read(of, slot, at?.flexion as number, at?.opening as number, cpu, 0);
            const turned = rotate(
              root as [number, number, number, number],
              cpu[0] as number,
              cpu[1] as number,
              cpu[2] as number,
            );
            const want = turned.map((x) => x * blend);
            if (of === shown && blend === 1 && part === 0 && Math.hypot(...turned) > 0) moved++;
            for (let k = 0; k < 3; k++)
              worst = Math.max(worst, Math.abs((px[v * 4 + k] as number) - (want[k] as number)));
          }
          return worst;
        };
        // The same halves: float error alone. The normal's change is some seven times the displacement's in size, so float error is too.
        expect(against(shown), `${left}/${right}: part ${part} at ${blend}`).toBeLessThan(
          part === 0 ? 2e-6 : 1e-5,
        );
        // The values before rounding: each within 2⁻¹¹ of its largest (0.1 and 0.75), a mix of them no further, and
        // turned, a vector's three no further than √3 of that between them.
        const largest = part === 0 ? 0.1 : 0.75;
        expect(against(fold), `${left}/${right}: part ${part} at ${blend}, unrounded`).toBeLessThan(
          largest * 2 ** -11 * Math.sqrt(3) * blend + (part === 0 ? 2e-6 : 1e-5),
        );
      }
    }
    // Most of what was asked is in the fold's range, so this compares displacements, not zeros.
    expect(moved).toBeGreaterThan(count * 2);
    target.dispose();
    input.dispose();
    material.dispose();
    dual.dispose();
  });
});

const SIZE = 96;
const camera = new OrthographicCamera(-2.4, 2.4, 3.6, -0.6, 0.1, 20);
camera.position.set(0.4, 0, 8);
camera.lookAt(0.4, 0, 0);

/** A tube round the spine, 24 rings by 14 around, each ring weighted between the two bones it lies between. */
function tube() {
  const rings = 24;
  const around = 14;
  const positions: number[] = [];
  const normals: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  for (let r = 0; r < rings; r++) {
    const y = (r / (rings - 1)) * 3.2 - 0.1;
    // Between bones whose heads are at y = 0, 1, 2, 3 (root, spine, chest, head), blending across each joint.
    const j = Math.min(2, Math.max(0, Math.floor(y)));
    const f = Math.min(1, Math.max(0, y - j));
    const smooth = f * f * (3 - 2 * f);
    for (let a = 0; a < around; a++) {
      const t = (a / around) * Math.PI * 2;
      positions.push(0.35 * Math.cos(t), y, 0.35 * Math.sin(t));
      normals.push(Math.cos(t), 0, Math.sin(t));
      skinIndex.push(j, j + 1, 0, 0);
      skinWeight.push(1 - smooth, smooth, 0, 0);
    }
  }
  const index: number[] = [];
  for (let r = 0; r + 1 < rings; r++)
    for (let a = 0; a < around; a++) {
      const b = (a + 1) % around;
      const p = r * around;
      const q = (r + 1) * around;
      index.push(p + a, q + a, q + b, p + a, q + b, p + b);
    }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    skinIndex: Uint16Array.from(skinIndex),
    skinWeight: Float32Array.from(skinWeight),
    index,
  };
}

const TUBE = tube();

/** A skinned tube posed by three's bones (set from `rotations`), with `material`. */
function skinned(material: MeshNormalMaterial, rotations: BoneRotations): SkinnedMesh {
  const geometry = new BufferGeometry();
  geometry.setIndex(TUBE.index);
  geometry.setAttribute("position", new BufferAttribute(TUBE.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(TUBE.normals, 3));
  geometry.setAttribute("skinIndex", new BufferAttribute(TUBE.skinIndex, 4));
  geometry.setAttribute("skinWeight", new BufferAttribute(TUBE.skinWeight, 4));
  const bones = NAMES.map(() => new Bone());
  const scene = new Scene();
  NAMES.forEach((_, b) => {
    const p = PARENTS[b] as number;
    const at = [0, 1, 2].map(
      (k) => (HEADS[b * 3 + k] as number) - (p < 0 ? 0 : (HEADS[p * 3 + k] as number)),
    );
    bones[b]?.position.set(at[0] as number, at[1] as number, at[2] as number);
    bones[b]?.quaternion.fromArray(rotations, b * 4);
    if (p >= 0) bones[p]?.add(bones[b] as Bone);
  });
  scene.add(bones[0] as Bone);
  const skeleton = new Skeleton(bones);
  bones.forEach((_, b) => {
    skeleton.boneInverses[b]?.makeTranslation(
      -(HEADS[b * 3] as number),
      -(HEADS[b * 3 + 1] as number),
      -(HEADS[b * 3 + 2] as number),
    );
  });
  const mesh = new SkinnedMesh(geometry, material);
  mesh.bind(skeleton, new Matrix4());
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  return mesh;
}

/** The scene's pixels from the test camera. */
function draw(mesh: Mesh): Uint8Array {
  const target = new WebGLRenderTarget(SIZE, SIZE, { type: UnsignedByteType });
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(mesh.parent as Scene, camera);
  const px = new Uint8Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, px);
  renderer.setRenderTarget(null);
  target.dispose();
  return px;
}

/** How the two images differ: the mean channel error and the share of pixels off by more than 16/255. */
function compare(a: Uint8Array, b: Uint8Array): { mean: number; off: number; covered: number } {
  let sum = 0;
  let off = 0;
  let covered = 0;
  for (let i = 0; i < a.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 4; k++)
      d = Math.max(d, Math.abs((a[i + k] as number) - (b[i + k] as number)));
    sum += d;
    if (d > 16) off++;
    if ((a[i + 3] as number) > 0 || (b[i + 3] as number) > 0) covered++;
  }
  return {
    mean: sum / (a.length / 4),
    off: off / (a.length / 4),
    covered: covered / (a.length / 4),
  };
}

/** The same tube, posed on the CPU by the reference and drawn unskinned. */
function posedOnCpu(rotations: BoneRotations, share: number[]): Mesh {
  const geometry = new BufferGeometry();
  geometry.setIndex(TUBE.index);
  const n = TUBE.positions.length / 3;
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      skinPositionsBlended(
        rest,
        rotations,
        TUBE.positions,
        TUBE.skinIndex,
        TUBE.skinWeight,
        new Float32Array(n * 3),
        share,
      ),
      3,
    ),
  );
  geometry.setAttribute(
    "normal",
    new BufferAttribute(
      skinNormalsBlended(
        rest,
        rotations,
        TUBE.normals,
        TUBE.skinIndex,
        TUBE.skinWeight,
        new Float32Array(n * 3),
        share,
      ),
      3,
    ),
  );
  const mesh = new Mesh(geometry, new MeshNormalMaterial());
  const scene = new Scene();
  scene.add(mesh);
  return mesh;
}

describe("the package's public surface for custom materials", () => {
  it("exports applyDualSkinning and DualBones from humanoid-kit/react, which skin a material by them", () => {
    expect(pkg.applyDualSkinning).toBe(applyDualSkinning);
    expect(pkg.DualBones).toBe(DualBones);
  });
});

describe("a skinned mesh drawn by the patched shader", () => {
  for (const [name, rotations] of POSES) {
    it(`matches the CPU reference, ${name}`, () => {
      const material = new MeshNormalMaterial();
      const bones = new DualBones(NAMES.length, SHARE);
      bones.update(rest, rotations);
      applyDualSkinning(material, bones);
      const gpu = draw(skinned(material, rotations));
      const cpu = draw(posedOnCpu(rotations, SHARE));
      const { mean, off, covered } = compare(gpu, cpu);
      expect(covered).toBeGreaterThan(0.05);
      expect(mean).toBeLessThan(1.5);
      expect(off).toBeLessThan(0.004);
      bones.dispose();
    });
  }

  it("draws exactly what three does where no bone asks for dual quaternions", () => {
    const rotations = (POSES[1] as [string, BoneRotations])[1];
    const plain = draw(skinned(new MeshNormalMaterial(), rotations));
    const material = new MeshNormalMaterial();
    const bones = new DualBones(NAMES.length, 0);
    bones.update(rest, rotations);
    applyDualSkinning(material, bones);
    const patched = draw(skinned(material, rotations));
    expect(compare(patched, plain).off).toBe(0);
    expect(compare(patched, plain).mean).toBeLessThan(0.25);
    bones.dispose();
  });

  it("differs from three's linear skinning where bones do ask: a twisted joint does not collapse", () => {
    const rotations = (POSES[1] as [string, BoneRotations])[1];
    const plain = draw(skinned(new MeshNormalMaterial(), rotations));
    const material = new MeshNormalMaterial();
    const bones = new DualBones(NAMES.length, SHARE);
    bones.update(rest, rotations);
    applyDualSkinning(material, bones);
    const patched = draw(skinned(material, rotations));
    expect(compare(patched, plain).off).toBeGreaterThan(0.01);
    bones.dispose();
  });

  it("gives the mesh's own CPU skinning (bounds, picking) the dual quaternion pose", () => {
    const rotations = (POSES[1] as [string, BoneRotations])[1];
    const material = new MeshNormalMaterial();
    const bones = new DualBones(NAMES.length, SHARE);
    const mesh = skinned(material, rotations);
    // Three's own CPU skinning is linear: it puts a vertex somewhere else.
    const linear = mesh.getVertexPosition(150, new Vector3());
    followDualSkinning(mesh, bones);
    bones.update(rest, rotations);
    const cpu = skinPositionsBlended(
      rest,
      rotations,
      TUBE.positions,
      TUBE.skinIndex,
      TUBE.skinWeight,
      new Float32Array(TUBE.positions.length),
      SHARE,
    );
    const followed = mesh.getVertexPosition(150, new Vector3());
    for (const [k, axis] of (["x", "y", "z"] as const).entries())
      expect(followed[axis], axis).toBeCloseTo(cpu[150 * 3 + k] as number, 5);
    expect(followed.distanceTo(linear)).toBeGreaterThan(0.01);
    // The mesh's bounds come from the same skinning: its box is the reference's.
    mesh.computeBoundingBox();
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let v = 0; v < cpu.length / 3; v++) {
      lo = Math.min(lo, cpu[v * 3 + 1] as number);
      hi = Math.max(hi, cpu[v * 3 + 1] as number);
    }
    expect(mesh.boundingBox?.min.y).toBeCloseTo(lo, 4);
    expect(mesh.boundingBox?.max.y).toBeCloseTo(hi, 4);
    bones.dispose();
  });
});
