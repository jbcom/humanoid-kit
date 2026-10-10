/**
 * The affordance handle's frames against what the GPU draws (docs/ARCHITECTURE.md,
 * "Affordances: the registry", "The public API"): the landmark vertices of the
 * figure, skinned by the very shader the body is drawn with (`applyDualSkinning`
 * over three's own skinning, the same bones, fold and lifted group), read back
 * from a float target, are where `frame(id, "world")` says, to 2e-5 m. Seated
 * (the hip fold, whose vertices are checked too), with the jaw dropped by a
 * face unit, lifted onto the ground by presence, halfway through the fold's
 * fade, with a custom material (linear, no fold), and with the jaw opened by
 * the mouth's affordance instead of the pose.
 */
import { Canvas, type RootState, useThree } from "@react-three/fiber";
import { type ReactNode, useEffect } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  FloatType,
  GLSL3,
  type Group,
  type Material,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  Points,
  Scene,
  ShaderMaterial,
  type SkinnedMesh,
  Vector3,
  WebGLRenderTarget,
} from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { createPresenceRegistry } from "../../src/presence/presence.ts";
import {
  AffordanceAnchor,
  applyDualSkinning,
  type DualBones,
  Humanoid,
  type HumanoidAffordances,
  type HumanoidPose,
  HumanoidProvider,
  PresenceProvider,
  useHumanoidAffordances,
} from "../../src/react/index.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { FOLD_SLOT_ATTRIBUTE } from "../../src/render/dualSkinning.ts";
import type { SurfaceAnchors } from "../../src/worker/protocol.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const LOAD = { timeout: 300_000 };
/** How far a frame may be from the vertex the GPU draws, metres: float32 skinning on both sides. */
const EXACT = 2e-5;

const client = inlineWorkerClient({ subdivision: 1 });
let anchors: SurfaceAnchors;
beforeAll(async () => {
  await client.ready;
  anchors = await client.landmarkAnchors();
}, LOAD.timeout);
afterAll(() => client.dispose());

/** Hands the test the canvas's state, and the handle the figure is given. */
function Probe({ onReady }: { onReady: (get: () => RootState) => void }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    onReady(get);
  }, [get, onReady]);
  return null;
}

interface Shown {
  get: () => RootState;
  h: HumanoidAffordances;
}

/** A figure given a handle (`useHumanoidAffordances`), rendered and settled, its fold faded in. */
async function show(
  figure: (h: HumanoidAffordances, onSettled: () => void) => ReactNode,
  wrap: (children: ReactNode) => ReactNode = (c) => c,
  using: typeof client = client,
): Promise<Shown> {
  let get: (() => RootState) | null = null;
  let handle: HumanoidAffordances | null = null;
  let settled = false;
  function Figure() {
    const h = useHumanoidAffordances();
    handle = h;
    return <>{figure(h, () => (settled = true))}</>;
  }
  await render(
    <HumanoidProvider client={using}>
      <div style={{ width: 160, height: 160 }}>
        <Canvas>
          <Probe onReady={(g) => (get = g)} />
          {wrap(<Figure />)}
        </Canvas>
      </div>
    </HumanoidProvider>,
  );
  await expect.poll(() => settled, LOAD).toBe(true);
  const shown = {
    get: get as unknown as () => RootState,
    h: handle as unknown as HumanoidAffordances,
  };
  // The fold fades in over a few frames once it arrives.
  await expect.poll(() => bonesOf(shown.get().scene)?.foldBlend.value, LOAD).toBe(1);
  await expect.poll(() => shown.h.frame("mouth") !== null, LOAD).toBe(true);
  return shown;
}

function bonesOf(scene: Object3D): DualBones | null {
  let found: DualBones | null = null;
  scene.traverse((o) => {
    const d = (o.userData as { dualBones?: DualBones | null }).dualBones;
    if (d) found = d;
  });
  return found;
}

/** The body mesh drawn (the base surface's or the adult one's, whichever shows). */
function bodyOf(scene: Object3D): SkinnedMesh {
  let found: SkinnedMesh | null = null;
  scene.traverse((o) => {
    const part = o.userData.hkPart;
    if ((part === "body" || part === "adultBody") && o.visible) found = o as SkinnedMesh;
  });
  if (!found) throw new Error("no body drawn");
  return found;
}

/**
 * Where the GPU draws render vertices `vertices` of the body, in world space:
 * drawn as points by a shader skinned exactly as the body's material is (three's
 * skinning with the body's bones, then, unless `linear`, `applyDualSkinning`
 * with its fold), into a float target, and read back.
 */
function gpuPositions(state: RootState, vertices: readonly number[], linear = false): Float32Array {
  const scene = state.scene;
  const mesh = bodyOf(scene);
  const dual = bonesOf(scene) as DualBones;
  scene.updateMatrixWorld(true);
  mesh.skeleton.update();
  const g = mesh.geometry;
  const n = vertices.length;
  const pick = (name: string, size: number) => {
    const from = g.getAttribute(name);
    const out = new Float32Array(n * size);
    vertices.forEach((v, i) => {
      for (let k = 0; k < size; k++) out[i * size + k] = from.getComponent(v, k);
    });
    return new BufferAttribute(out, size);
  };
  const points = new BufferGeometry();
  points.setAttribute("position", pick("position", 3));
  points.setAttribute("skinIndex", pick("skinIndex", 4));
  points.setAttribute("skinWeight", pick("skinWeight", 4));
  points.setAttribute(FOLD_SLOT_ATTRIBUTE, pick(FOLD_SLOT_ATTRIBUTE, 1));
  points.setAttribute(
    "aPixel",
    new BufferAttribute(
      Float32Array.from({ length: n }, (_, i) => i),
      1,
    ),
  );
  const material: Material = new ShaderMaterial({
    glslVersion: GLSL3,
    defines: { USE_SKINNING: "" },
    depthTest: false,
    depthWrite: false,
    uniforms: {
      bindMatrix: { value: mesh.bindMatrix },
      bindMatrixInverse: { value: mesh.bindMatrixInverse },
      boneTexture: { value: mesh.skeleton.boneTexture },
      uWorld: { value: mesh.matrixWorld },
      uCount: { value: n },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      in float aPixel;
      uniform mat4 uWorld;
      uniform float uCount;
      out vec3 vWorld;
      void main() {
        #include <begin_vertex>
        #include <skinbase_vertex>
        #include <skinning_vertex>
        vWorld = ( uWorld * vec4( transformed, 1.0 ) ).xyz;
        gl_PointSize = 1.0;
        gl_Position = vec4( ( aPixel + 0.5 ) / uCount * 2.0 - 1.0, 0.0, 0.0, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      in vec3 vWorld;
      layout( location = 0 ) out highp vec4 outColor;
      void main() { outColor = vec4( vWorld, 1.0 ); }`,
  });
  if (!linear) applyDualSkinning(material, dual, true);
  const drawn = new Points(points, material);
  drawn.frustumCulled = false;
  const stage = new Scene();
  stage.add(drawn);
  const target = new WebGLRenderTarget(n, 1, { type: FloatType, depthBuffer: false });
  state.gl.setRenderTarget(target);
  state.gl.render(stage, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
  const px = new Float32Array(n * 4);
  state.gl.readRenderTargetPixels(target, 0, 0, n, 1, px);
  state.gl.setRenderTarget(null);
  target.dispose();
  material.dispose();
  points.dispose();
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) out.set(px.subarray(i * 4, i * 4 + 3), i * 3);
  return out;
}

const gap = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  Math.hypot(
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  );

/**
 * The worst distance, metres, between the handle's world frames and the GPU's
 * vertices: every affordance on a surface landmark (the mouth at its lips'
 * midpoint), every surface landmark, and, with `foldVertices`, as many of the
 * vertices the fold moves (`vertex`).
 */
function worstAgainstGpu(shown: Shown, linear = false, foldVertices = 0) {
  const state = shown.get();
  const { h } = shown;
  const body = bodyOf(state.scene);
  const surface = body.userData.hkPart === "adultBody" ? "adult" : "base";
  const marks = anchors[surface];
  if (!marks) throw new Error(`no anchors on the ${surface} surface`);
  const ids = Object.keys(marks.vertices) as (keyof typeof marks.vertices)[];
  const slots = body.geometry.getAttribute(FOLD_SLOT_ATTRIBUTE);
  const folded: number[] = [];
  for (let v = 0; v < slots.count && folded.length < foldVertices; v++)
    if (slots.getX(v) >= 0) folded.push(v);
  const vertices = [...ids.map((id) => marks.vertices[id].vertex), ...folded];
  const gpu = gpuPositions(state, vertices, linear);
  const at = (i: number) => gpu.subarray(i * 3, i * 3 + 3);
  let worst = 0;
  ids.forEach((id, i) => {
    const f = h.landmark(id, "world");
    if (!f) throw new Error(`${id}: no frame`);
    worst = Math.max(worst, gap(f.position, at(i)));
  });
  for (const a of h.own) {
    if (!("landmark" in a.at) && !("between" in a.at)) continue;
    const f = h.frame(a.id, "world");
    if (!f) throw new Error(`${a.id}: no frame`);
    if ("between" in a.at) {
      const [p, q] = a.at.between.map((id) => at(ids.indexOf(id as (typeof ids)[number])));
      const mid = [0, 1, 2].map((k) => ((p?.[k] as number) + (q?.[k] as number)) / 2);
      worst = Math.max(worst, gap(f.position, mid));
    } else if (ids.includes(a.at.landmark as (typeof ids)[number]))
      worst = Math.max(
        worst,
        gap(f.position, at(ids.indexOf(a.at.landmark as (typeof ids)[number]))),
      );
  }
  folded.forEach((v, j) => {
    const p = h.vertex(v, "world");
    if (!p) throw new Error(`vertex ${v}: none`);
    worst = Math.max(worst, gap(p, at(ids.length + j)));
  });
  return { worst, folded: folded.length };
}

const seated: HumanoidPose = { body: "seated", faceUnits: { JawDrop: 1 } };

describe("the affordance handle against the GPU", () => {
  it(
    "frames every landmark and affordance where the GPU draws it, seated with the jaw dropped, the fold whole and halfway in",
    async () => {
      const shown = await show((h, onSettled) => (
        <Humanoid recipe={createRecipe()} pose={seated} affordances={h} onSettled={onSettled} />
      ));
      const whole = worstAgainstGpu(shown, false, 300);
      expect(whole.folded, "vertices the fold moves").toBe(300);
      expect(whole.worst, "fold whole").toBeLessThan(EXACT);
      // Halfway through the fold's fade: both read the same share of it.
      const dual = bonesOf(shown.get().scene) as DualBones;
      dual.foldBlend.value = 0.5;
      const half = worstAgainstGpu(shown, false, 300);
      dual.foldBlend.value = 1;
      expect(half.worst, "fold half shown").toBeLessThan(EXACT);
    },
    LOAD.timeout,
  );

  it(
    "skins an organ's vertices by the figure's own weights where the GPU does, seated",
    async () => {
      const adult = inlineWorkerClient({ subdivision: 1 }, { adultAnatomy: true });
      await adult.ready;
      const shown = await show(
        (h, onSettled) => (
          <Humanoid
            recipe={createRecipe({ macros: { gender: 1 } })}
            pose={seated}
            affordances={h}
            onSettled={onSettled}
          />
        ),
        (c) => c,
        adult,
      );
      const body = bodyOf(shown.get().scene);
      expect(body.userData.hkPart).toBe("adultBody");
      const topology = await adult.adultSurface();
      if (!topology) throw new Error("no adult surface");
      // The organ's vertices: where the weights drawn are not the topology's (`evaluatedSkin`).
      const drawn = body.geometry.getAttribute("skinWeight");
      const organ: number[] = [];
      for (let v = 0; v < drawn.count; v++)
        for (let k = 0; k < 4; k++)
          if (drawn.getComponent(v, k) !== topology.skinWeight[v * 4 + k]) {
            organ.push(v);
            break;
          }
      expect(organ.length, "vertices skinned by their root's weights").toBeGreaterThan(1000);
      const step = Math.ceil(organ.length / 400);
      const sample = organ.filter((_, i) => i % step === 0);
      const gpu = gpuPositions(shown.get(), sample);
      let worst = 0;
      sample.forEach((v, i) => {
        const p = shown.h.vertex(v, "world");
        if (!p) throw new Error(`vertex ${v}: none`);
        worst = Math.max(worst, gap(p, gpu.subarray(i * 3, i * 3 + 3)));
      });
      // The organ lies where the seated thighs flex: the fold moves it, on rows past what a
      // texture a row a line could hold, so this compares the fold too.
      const slots = body.geometry.getAttribute(FOLD_SLOT_ATTRIBUTE);
      expect(sample.filter((v) => slots.getX(v) >= 0).length).toBeGreaterThan(sample.length / 2);
      expect(worst).toBeLessThan(EXACT);
      adult.dispose();
    },
    LOAD.timeout,
  );

  it(
    "carries the frames to world space through presence's lift and placement, and keeps a caller's ref",
    async () => {
      const registry = createPresenceRegistry();
      let mine: Group | null = null;
      const earring = new Object3D();
      const shown = await show(
        (h, onSettled) => (
          <>
            <Humanoid
              ref={(g: Group | null) => {
                mine = g;
              }}
              recipe={createRecipe()}
              pose={seated}
              presence={{ id: "a", position: [0.4, 0, -0.3], facing: [1, 0, 0.5] }}
              affordances={h}
              onSettled={onSettled}
            />
            <AffordanceAnchor of={h} at="ear-lobe.L">
              <primitive object={earring} />
            </AffordanceAnchor>
          </>
        ),
        (children) => <PresenceProvider registry={registry}>{children}</PresenceProvider>,
      );
      expect(worstAgainstGpu(shown, false, 100).worst).toBeLessThan(EXACT);
      // The figure is lifted onto its ground and placed, so the comparison above was through both.
      const lifted = shown.h.lifted;
      expect(lifted?.position.y, "the figure lifted onto its ground").toBeGreaterThan(0.1);
      expect(lifted?.parent?.position.x).toBeCloseTo(0.4, 6);
      // The caller's ref holds the group, and the figure's own still does: it published.
      expect((mine as Group | null)?.userData.dualBones).toBe(bonesOf(shown.get().scene));
      await expect.poll(() => registry.get("a"), LOAD).toBeDefined();
      // What an anchor holds sits on its affordance's frame: +z out along the normal, +x along the tangent.
      shown.get().scene.updateMatrixWorld(true);
      const lobe = shown.h.frame("ear-lobe.L", "world");
      if (!lobe) throw new Error("no ear lobe");
      const e = earring.matrixWorld.elements;
      expect(earring.parent?.parent, "drawn in the lifted group").toBe(lifted);
      expect(gap([e[12] as number, e[13] as number, e[14] as number], lobe.position)).toBeLessThan(
        1e-6,
      );
      expect(gap([e[8] as number, e[9] as number, e[10] as number], lobe.normal)).toBeLessThan(
        1e-6,
      );
      expect(gap([e[0] as number, e[1] as number, e[2] as number], lobe.tangent)).toBeLessThan(
        1e-6,
      );
    },
    LOAD.timeout,
  );

  it(
    "skins linearly with no fold under a custom material, as the figure then does",
    async () => {
      const material = new MeshStandardMaterial();
      const shown = await show((h, onSettled) => (
        <Humanoid
          recipe={createRecipe()}
          pose={seated}
          material={material}
          affordances={h}
          onSettled={onSettled}
        />
      ));
      expect(worstAgainstGpu(shown, true, 100).worst).toBeLessThan(EXACT);
      material.dispose();
    },
    LOAD.timeout,
  );

  it(
    "opens the drawn jaw when the mouth's opening is set, so the lips drawn are where the frames say",
    async () => {
      const shown = await show((h, onSettled) => (
        <Humanoid
          recipe={createRecipe()}
          pose={{ body: "relaxed" }}
          affordances={h}
          onSettled={onSettled}
        />
      ));
      const { h } = shown;
      const closed = h.landmark("lower-lip", "world");
      if (!closed) throw new Error("no lower lip");
      const before = closed.position[1];
      h.set("mouth", { opening: 1 });
      // The next frame writes the jaw: the lower lip comes down.
      await expect
        .poll(() => {
          const now = h.landmark("lower-lip", "world");
          return now ? before - now.position[1] : 0;
        }, LOAD)
        .toBeGreaterThan(0.005);
      expect(worstAgainstGpu(shown).worst).toBeLessThan(EXACT);
      // The channel opens with it: a point just inside the open lips is inside.
      const mouth = h.channel("mouth");
      if (!mouth) throw new Error("no mouth");
      const world = shown.h.lifted?.matrixWorld;
      if (!world) throw new Error("no lifted group");
      const p = new Vector3(...mouth.origin)
        .addScaledVector(new Vector3(...mouth.inward), 0.005)
        .applyMatrix4(world);
      expect(h.place("mouth", [p.x, p.y, p.z])?.inside).toBe(true);
      // The handle's clip holds the figure's apertures, the mouth open, where they are drawn.
      const clip = h.clip;
      const apertures = h.own.filter((a) => a.channel).length;
      await expect.poll(() => clip.uniforms.hkClipCount.value, LOAD).toBe(apertures);
      const rim = new Vector3(...mouth.origin).applyMatrix4(world);
      expect(clip.uniforms.hkClipOrigin.value[0]?.distanceTo(rim)).toBeLessThan(1e-5);
      const halfUp = (clip.uniforms.hkClipKnot.value[0] as Vector3).z;
      expect(halfUp, "the mouth's rim open in the clip").toBeGreaterThan(0.01);
      // It keeps itself current: the mouth closed, the clip's rim closes on the next frame.
      h.set("mouth", { opening: 0 });
      await expect.poll(() => (clip.uniforms.hkClipKnot.value[0] as Vector3).z, LOAD).toBe(0);
    },
    LOAD.timeout,
  );
});
