/** Demand-rendering contracts: an idle creator must wake for late figure data. */
import { Canvas, type RootState, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useState } from "react";
import {
  GLSL3,
  Mesh,
  NoBlending,
  type Object3D,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  Scene,
  UnsignedByteType,
  WebGLRenderTarget,
} from "three";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  AffordanceAnchor,
  Humanoid,
  HumanoidProvider,
  useHumanoidAffordances,
} from "../../src/react/index.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { SkinMaterial } from "../../src/render/skinMaterial.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const LOAD = { timeout: 120_000 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function FrameProbe({ tick }: { tick: () => void }) {
  useFrame(tick);
  return null;
}

function StateProbe({ onReady }: { onReady: (get: () => RootState) => void }) {
  const get = useThree((s) => s.get);
  useEffect(() => onReady(get), [get, onReady]);
  return null;
}

async function browserFrames(count: number) {
  for (let i = 0; i < count; i++)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function reachesFramePlateau(read: () => number, stableFrames = 8, maximumFrames = 120) {
  let previous = read();
  let stable = 0;
  for (let frame = 0; frame < maximumFrames; frame++) {
    await browserFrames(1);
    const current = read();
    stable = current === previous ? stable + 1 : 0;
    if (stable >= stableFrames) return true;
    previous = current;
  }
  return false;
}

function skinOf(scene: Object3D): SkinMaterial {
  let material: SkinMaterial | null = null;
  scene.traverse((node) => {
    const candidate = (node as { material?: unknown }).material;
    if (!material && candidate instanceof SkinMaterial) material = candidate;
  });
  if (!material) throw new Error("no figure skin material");
  return material;
}

/**
 * Reads a layer's mask from the actual shared atlas. This is deliberately a
 * neutral field image: it proves the worker's real update changed GPU data
 * without claiming a camera crop or lighting difference is the layer.
 */
function atlasMaskMean(state: RootState, skin: SkinMaterial, layerId: string): number {
  const index = skin.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) throw new Error(`skin layer ${layerId} is absent`);
  const channel = skin.hkUniforms.hkChannel.value[index]?.x;
  if (channel === undefined || channel < 0) throw new Error(`skin layer ${layerId} has no mask`);
  const side = 64;
  const target = new WebGLRenderTarget(side, side, {
    type: UnsignedByteType,
    depthBuffer: false,
  });
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    uniforms: {
      atlas: { value: skin.hkUniforms.hkLayerAtlas.value },
      channel: { value: channel },
    },
    vertexShader: `in vec3 position; out vec2 vUv;
      void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `precision highp float; precision highp sampler2DArray;
      uniform highp sampler2DArray atlas; uniform float channel; in vec2 vUv; out vec4 color;
      void main() {
        vec4 page = texture(atlas, vec3(vUv, floor(channel * 0.25)));
        int component = int(channel - 4.0 * floor(channel * 0.25) + 0.5);
        color = vec4(page[component], 0.0, 0.0, 1.0);
      }`,
    blending: NoBlending,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  const camera = new OrthographicCamera();
  const pixels = new Uint8Array(side * side * 4);
  const previous = state.gl.getRenderTarget();
  try {
    state.gl.setRenderTarget(target);
    state.gl.clear();
    state.gl.render(scene, camera);
    state.gl.readRenderTargetPixels(target, 0, 0, side, side, pixels);
    return (
      pixels.reduce((sum, value, offset) => sum + (offset % 4 === 0 ? value : 0), 0) /
      (side * side * 255)
    );
  } finally {
    state.gl.setRenderTarget(previous);
    quad.geometry.dispose();
    material.dispose();
    target.dispose();
  }
}

function SwitchingMouthMarker({
  onFirstSettled,
  onSwitch,
  onMarker,
}: {
  onFirstSettled: () => void;
  onSwitch: (switchToSecond: () => void) => void;
  onMarker: (marker: Mesh | null) => void;
}) {
  const first = useHumanoidAffordances();
  const second = useHumanoidAffordances();
  const [useSecond, setUseSecond] = useState(false);
  useEffect(() => onSwitch(() => setUseSecond(true)), [onSwitch]);
  const affordances = useSecond ? second : first;
  return (
    <>
      <Humanoid
        key={useSecond ? "later-handle" : "first-handle"}
        recipe={createRecipe()}
        affordances={affordances}
        onSettled={() => {
          if (!useSecond) onFirstSettled();
        }}
      />
      <AffordanceAnchor of={affordances} at="mouth">
        <mesh ref={onMarker} name="affordance-marker">
          <sphereGeometry args={[0.08, 12, 8]} />
          <meshBasicMaterial color="#ff0000" />
        </mesh>
      </AffordanceAnchor>
    </>
  );
}

describe("demand-rendered figures", () => {
  it(
    "draws an affordance anchor when a later affordance handle receives landmarks",
    async () => {
      const client = inlineWorkerClient();
      await client.ready;
      const anchors = client.landmarkAnchors();
      const release = deferred<void>();
      let landmarkCalls = 0;
      client.landmarkAnchors = () => {
        landmarkCalls++;
        return landmarkCalls === 1 ? anchors : release.promise.then(() => anchors);
      };
      let frames = 0;
      let firstSettled = false;
      const controls = {
        switchToSecond: null as (() => void) | null,
        marker: null as Mesh | null,
      };
      try {
        await render(
          <HumanoidProvider client={client}>
            <div style={{ width: 160, height: 160 }}>
              <Canvas frameloop="demand">
                <FrameProbe tick={() => frames++} />
                <SwitchingMouthMarker
                  onFirstSettled={() => (firstSettled = true)}
                  onSwitch={(next) => (controls.switchToSecond = next)}
                  onMarker={(next) => (controls.marker = next)}
                />
              </Canvas>
            </div>
          </HumanoidProvider>,
        );
        await expect.poll(() => firstSettled, LOAD).toBe(true);
        expect(await reachesFramePlateau(() => frames)).toBe(true);
        const switchToSecond = controls.switchToSecond;
        if (!switchToSecond) throw new Error("the test did not receive its handle switch");
        switchToSecond();
        await expect.poll(() => landmarkCalls, LOAD).toBe(2);
        await expect.poll(() => controls.marker?.parent !== null, LOAD).toBe(true);
        const marker = controls.marker;
        if (!marker?.parent) throw new Error("the later affordance marker did not mount");
        await browserFrames(2);
        expect(marker.parent.visible).toBe(false);

        release.resolve();
        await browserFrames(16);
        expect(marker.parent.visible).toBe(true);
      } finally {
        client.dispose();
      }
    },
    LOAD.timeout,
  );

  it(
    "redraws after the real adult layer atlas reaches an idle figure",
    async () => {
      const client = inlineWorkerClient({ subdivision: 0 }, { adultAnatomy: true });
      let frames = 0;
      const canvas = { get: null as (() => RootState) | null };
      try {
        const update = await client.adultLayers();
        if (!update) throw new Error("the adult fixture produced no layer update");
        const release = deferred<typeof update>();
        client.adultLayers = () => release.promise;
        await render(
          <HumanoidProvider client={client}>
            <div style={{ width: 160, height: 160 }}>
              <Canvas frameloop="demand">
                <StateProbe onReady={(next) => (canvas.get = next)} />
                <FrameProbe tick={() => frames++} />
                <Humanoid recipe={createRecipe({ macros: { age: 30, gender: 1 } })} />
              </Canvas>
            </div>
          </HumanoidProvider>,
        );
        await expect.poll(() => canvas.get, LOAD).not.toBeNull();
        await expect
          .poll(() => {
            const state = canvas.get?.();
            return state ? skinOf(state.scene) : null;
          }, LOAD)
          .not.toBeNull();
        expect(await reachesFramePlateau(() => frames)).toBe(true);
        const readState = canvas.get;
        if (!readState) throw new Error("the canvas state probe did not mount");
        const state = readState();
        const skin = skinOf(state.scene);
        const before = atlasMaskMean(state, skin, "mound-skin");
        expect(before).toBeLessThan(0.001);

        const beforeFrames = frames;
        release.resolve(update);
        await browserFrames(16);
        const after = atlasMaskMean(state, skin, "mound-skin");
        expect(after).toBeGreaterThan(before + 0.001);
        expect(frames).toBeGreaterThan(beforeFrames);
      } finally {
        client.dispose();
      }
    },
    LOAD.timeout,
  );
});
