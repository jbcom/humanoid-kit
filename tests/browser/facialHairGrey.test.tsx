/** Analytic pigment parity and actual Humanoid lifecycle; source-asset visual acceptance is separate. */
import { Canvas } from "@react-three/fiber";
import type { ChromiumGpuMode } from "game-harness/chromium";
import {
  DataTexture,
  FloatType,
  type Group,
  type Material,
  Mesh,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  type SkinnedMesh,
  SRGBColorSpace,
  TextureLoader,
  UnsignedByteType,
  WebGLRenderTarget,
} from "three";
import { expect, inject, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { decodeMiniature, encodeMiniature } from "../../src/bake/format.ts";
import type { MiniatureBake } from "../../src/bake/miniature.ts";
import { Humanoid, HumanoidProvider } from "../../src/react/index.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { facialHairGreyTexture } from "../../src/render/facialHairGrey.ts";
import {
  HairMaterial,
  setHairOcclusionAttribute,
  setHairStrandAttributes,
} from "../../src/render/hairMaterial.ts";
import { MiniatureCrowd } from "../../src/render/miniature.ts";
import type {
  FacialHairGreyMasks,
  ResolvedFacialHairGrey,
} from "../../src/surface/facialHairGrey.ts";
import { srgbToLinear } from "../../src/surface/skinTone.ts";
import { createTestRenderer, releaseTestRenderer } from "./gl.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

declare module "vitest" {
  interface ProvidedContext {
    browserGpuMode: ChromiumGpuMode;
  }
}

function albedoOnly(material: Material): void {
  const compile = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|albedo-diagnostic`;
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      "outgoingLight = diffuseColor.rgb;\n#include <opaque_fragment>",
    );
  };
}

it("samples identical top-first linear UV weights in live and decoded miniature pigment", () => {
  const renderer = createTestRenderer();
  renderer.setSize(64, 64, false);
  renderer.toneMapping = NoToneMapping;
  const target = new WebGLRenderTarget(64, 64, { type: FloatType });
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 3;
  const field: ResolvedFacialHairGrey = {
    sourceSha256: "a".repeat(64),
    width: 2,
    height: 2,
    data: new Uint8Array([0, 255, 128, 0]),
    amount: 0.5,
    tint: [1.375, 1.375, 1.375],
  };
  const rgba = new Uint8Array([170, 170, 170, 255]);
  const map = new DataTexture(rgba, 1, 1, RGBAFormat, UnsignedByteType);
  map.colorSpace = SRGBColorSpace;
  map.needsUpdate = true;
  const geometry = new PlaneGeometry(2, 2);
  const count = geometry.getAttribute("position").count;
  setHairOcclusionAttribute(geometry, new Float32Array(count).fill(1));
  setHairStrandAttributes(
    geometry,
    new Float32Array(count).fill(1),
    new Float32Array(count),
    new Float32Array(count),
    new Float32Array(count).fill(1),
  );
  const material = new HairMaterial();
  material.map = map;
  material.setColour({ eumelanin: 0, pheomelanin: 0, grey: 0, override: [0.08, 0.12, 0.16] });
  material.setMultisampled(false);
  const mask = facialHairGreyTexture(field);
  material.setGrey(field, mask);
  albedoOnly(material);
  const live = new Scene();
  live.add(new Mesh(geometry, material));
  const bake: MiniatureBake = {
    body: "surface",
    vertexCount: 3,
    frameCount: 1,
    clips: [],
    min: [-1, -1, 0],
    max: [1, 1, 0],
    positions: new Float32Array(9),
    colour: new Uint8Array(9),
    channel: new Uint8Array(3),
    lods: [{ target: 1, index: new Uint32Array([0, 1, 2]), normals: new Float32Array(9) }],
    alphaCards: [
      {
        id: "facial-source",
        vertexCount: count,
        index: Uint32Array.from(geometry.index?.array ?? []),
        positions: Float32Array.from(geometry.getAttribute("position").array),
        normals: Float32Array.from(geometry.getAttribute("normal").array),
        uvs: Float32Array.from(geometry.getAttribute("uv").array),
        texture: { width: 1, height: 1, rgba },
        tint: [0.2, 0.3, 0.4],
        grey: { ...field, data: Uint8Array.from(field.data) },
      },
    ],
  };
  const crowd = new MiniatureCrowd([decodeMiniature(encodeMiniature(bake))], {
    facialHairLod: "all",
  });
  crowd.object.traverse((object) => {
    if (object instanceof Mesh && !Array.isArray(object.material)) albedoOnly(object.material);
  });
  crowd.setFigures([{ archetype: 0, x: 0, z: 0 }]);
  crowd.update(camera, 0, 64);
  const miniature = new Scene();
  miniature.add(crowd.object);
  const pixels = (scene: Scene) => {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0, 0);
    renderer.clear();
    renderer.render(scene, camera);
    const values = new Float32Array(64 * 64 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 64, 64, values);
    return values;
  };
  try {
    const a = pixels(live),
      b = pixels(miniature);
    for (const [x, y, sample] of [
      [8, 56, 0],
      [56, 56, 1],
      [8, 8, 128 / 255],
      [56, 8, 0],
    ]) {
      if (x === undefined || y === undefined || sample === undefined)
        throw new Error("sample missing");
      for (const [channel, base] of [0.2, 0.3, 0.4].entries()) {
        const offset = (y * 64 + x) * 4 + channel;
        const expected = srgbToLinear(170) * ((1 - 0.5 * sample) * base + 0.5 * sample * 1.375);
        expect(a[offset]).toBeCloseTo(expected, 4);
        expect(b[offset]).toBeCloseTo(expected, 4);
        expect(a[offset]).toBeCloseTo(b[offset] as number, 5);
      }
    }
  } finally {
    crowd.dispose();
    geometry.dispose();
    material.dispose();
    map.dispose();
    mask.dispose();
    target.dispose();
    releaseTestRenderer(renderer);
  }
});

it("rejects missing live masks, recovers on registry-only updates and disposes replaced uploads", async () => {
  await page.viewport(480, 480);
  let evaluations = 0,
    settlements = 0;
  const errors: Error[] = [];
  const evaluated = Promise.withResolvers<void>();
  const client = inlineWorkerClient({ subdivision: 0 }, { hair: true });
  await client.ready;
  const id = "beard-long-scruffy";
  const recipe = createRecipe({
    facialHair: [id],
    facialHairGrey: { [id]: { mask: "caller-streak", amount: 1 } },
  });
  let group: Group | null = null;
  function Fixture({ masks }: { masks?: FacialHairGreyMasks }) {
    return (
      <Canvas style={{ width: 400, height: 400 }}>
        <HumanoidProvider client={client}>
          <Humanoid
            recipe={recipe}
            {...(masks && { facialHairGreyMasks: masks })}
            ref={(value) => {
              group = value;
            }}
            onError={(error) => errors.push(error)}
            onEvaluated={() => {
              evaluations++;
              evaluated.resolve();
            }}
            onSettled={() => settlements++}
          />
        </HumanoidProvider>
      </Canvas>
    );
  }
  function card(): SkinnedMesh {
    const topology = client.hairTopology(id);
    let found: SkinnedMesh | undefined;
    group?.traverse((object) => {
      const candidate = object as SkinnedMesh;
      if (
        candidate.isSkinnedMesh &&
        candidate.geometry.getAttribute("position").count === topology?.vertexCount &&
        candidate.geometry.index?.count === topology?.index.length
      )
        found = candidate;
    });
    if (!found) throw new Error("facial card missing");
    return found;
  }
  const started = performance.now();
  const screen = await render(<Fixture />);
  try {
    // Canvas mounts a separate async React root after the DOM render completes.
    await evaluated.promise;
    console.info("facial-grey-missing-mask-evaluated", performance.now() - started);
    await expect.poll(() => errors.length).toBeGreaterThan(0);
    expect(settlements).toBe(0);
    expect(card().visible).toBe(false);
    const sourceSha256 = client.hairTopology(id)?.sourceSha256;
    if (!sourceSha256) throw new Error("source checksum missing");
    const registry = {
      "caller-streak": {
        sourceSha256,
        width: 2,
        height: 2,
        data: new Uint8Array([0, 255, 128, 0]),
      },
    };
    const before = evaluations;
    const liveMaterial = card().material as HairMaterial;
    let uploaded: DataTexture | undefined;
    const compile = liveMaterial.onBeforeCompile.bind(liveMaterial);
    const key = liveMaterial.customProgramCacheKey.bind(liveMaterial);
    liveMaterial.customProgramCacheKey = () => `${key()}|lifecycle-inspection`;
    liveMaterial.onBeforeCompile = (shader) => {
      compile(shader);
      uploaded = shader.uniforms.hkGreyMap?.value as DataTexture;
    };
    await screen.rerender(<Fixture masks={registry} />);
    await expect.poll(() => settlements).toBe(1);
    expect(evaluations).toBe(before);
    expect(card().visible).toBe(true);
    const geometry = card().geometry;
    await expect.poll(() => uploaded?.image.data).toEqual(registry["caller-streak"].data);
    if (!uploaded) throw new Error("mask sampler did not reach the real GPU program");
    let disposed = 0;
    uploaded.addEventListener("dispose", () => disposed++);
    const changed = {
      "caller-streak": { ...registry["caller-streak"], data: new Uint8Array([255, 0, 0, 255]) },
    };
    await screen.rerender(<Fixture masks={changed} />);
    await expect.poll(() => settlements).toBe(2);
    expect(evaluations).toBe(before);
    expect(disposed).toBe(1);
    expect(card().geometry).toBe(geometry);
    expect(card().material).toBe(liveMaterial);
    expect(registry["caller-streak"].data.byteLength).toBe(4);
  } finally {
    await screen.unmount();
    client.dispose();
  }
}, 120_000);

it("holds a masked card through deferred source-map rejection and registry-only recovery", async () => {
  await page.viewport(480, 480);
  const id = "beard-long-scruffy";
  const client = inlineWorkerClient({ subdivision: 0 }, { hair: true });
  await client.ready;
  await client.evaluate(createRecipe({ facialHair: [id] }), "source-map-regression-prime");
  const sourceSha256 = client.hairTopology(id)?.sourceSha256;
  if (!sourceSha256) throw new Error("source style pin missing");
  const recipe = createRecipe({
    facialHair: [id],
    facialHairGrey: { [id]: { mask: "caller-streak", amount: 1 } },
  });
  const unmaskedRecipe = createRecipe({ facialHair: [id] });
  const registry = {
    "caller-streak": { sourceSha256, width: 2, height: 2, data: new Uint8Array([0, 255, 128, 0]) },
  };
  let group: Group | null = null;
  let settlements = 0,
    evaluations = 0;
  const settledMaps: boolean[] = [];
  let sourcePending = false,
    allowSource = false;
  let evaluated = Promise.withResolvers<void>();
  let started = performance.now();
  let rejectSource: ((error: Error) => void) | undefined;
  const errors: Error[] = [];
  let gpu = "";
  const actualLoad = TextureLoader.prototype.loadAsync;
  const loading = vi.spyOn(TextureLoader.prototype, "loadAsync").mockImplementation(function (
    this: TextureLoader,
    url,
    onProgress,
  ) {
    if (url.includes("beard-long-scruffy.webp") && !allowSource) {
      sourcePending = true;
      return new Promise((_resolve, reject) => {
        rejectSource = reject;
      });
    }
    return actualLoad.call(this, url, onProgress);
  });
  function rejectCurrentSource(reason: string): void {
    if (!rejectSource) throw new Error("source loader did not reach controlled boundary");
    rejectSource(new Error(reason));
  }
  function Fixture({ masks, masked = true }: { masks: FacialHairGreyMasks; masked?: boolean }) {
    return (
      <Canvas
        style={{ width: 400, height: 400 }}
        onCreated={({ gl }) => {
          const context = gl.getContext();
          const debug = context.getExtension("WEBGL_debug_renderer_info");
          gpu = debug ? String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "unavailable";
        }}
      >
        <HumanoidProvider client={client}>
          <Humanoid
            recipe={masked ? recipe : unmaskedRecipe}
            facialHairGreyMasks={masks}
            ref={(value) => {
              group = value;
            }}
            onError={(error) => errors.push(error)}
            onEvaluated={() => {
              evaluations++;
              evaluated.resolve();
            }}
            onSettled={() => {
              settlements++;
              settledMaps.push((card().material as HairMaterial).map !== null);
            }}
          />
        </HumanoidProvider>
      </Canvas>
    );
  }
  function card(): SkinnedMesh {
    const topology = client.hairTopology(id);
    let found: SkinnedMesh | undefined;
    group?.traverse((object) => {
      const candidate = object as SkinnedMesh;
      if (
        candidate.isSkinnedMesh &&
        candidate.geometry.getAttribute("position").count === topology?.vertexCount &&
        candidate.geometry.index?.count === topology?.index.length
      )
        found = candidate;
    });
    if (!found) throw new Error("source facial card missing");
    return found;
  }
  const frames = async (count: number) => {
    for (let i = 0; i < count; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  };
  const screen = await render(<Fixture masks={registry} />);
  let activeScreen = screen;
  try {
    await evaluated.promise;
    console.info("facial-grey-source-loader-evaluated", performance.now() - started);
    await expect.poll(() => sourcePending).toBe(true);
    await expect.poll(() => evaluations).toBe(1);
    const gpuMode = inject("browserGpuMode");
    expect(gpu).not.toMatch(/^$|unavailable/i);
    if (gpuMode === "software") expect(gpu).toMatch(/SwiftShader/i);
    else {
      if (gpuMode === "macos-hardware-metal") expect(gpu).toMatch(/Apple|Metal/i);
      expect(gpu).not.toMatch(/SwiftShader|llvmpipe|software/i);
    }
    console.info(
      "facial-grey-source-loader-native-gpu",
      JSON.stringify({ gpuMode, gpu, sourceSha256 }),
    );
    expect
      .soft(card().visible, "a masked card must remain hidden while its source RGBA is pending")
      .toBe(false);
    rejectCurrentSource("controlled source RGBA rejection");
    await expect
      .poll(() =>
        errors.some((error) => error.message.includes("controlled source RGBA rejection")),
      )
      .toBe(true);
    await frames(6);
    console.info(
      "facial-grey-source-loader-rejection",
      JSON.stringify({
        gpu,
        settlements,
        visible: card().visible,
        errors: errors.map((error) => error.message),
      }),
    );
    expect.soft(settlements, "a rejected required source map must not settle successfully").toBe(0);
    expect(
      card().visible,
      "a rejected required source map must hide the requested masked card",
    ).toBe(false);
    const before = evaluations;
    const originalMesh = card();
    allowSource = true;
    await screen.rerender(
      <Fixture masks={{ "caller-streak": { ...registry["caller-streak"] } }} />,
    );
    await expect.poll(() => settlements).toBe(1);
    expect(evaluations).toBe(before);
    expect(card()).toBe(originalMesh);
    expect(card().visible).toBe(true);
    expect((card().material as HairMaterial).map).not.toBeNull();
    expect(settledMaps.at(-1)).toBe(true);

    // A fresh mounted style first fails while unmasked. Its outward legacy
    // behavior remains unchanged, but activation must remember and retry that failure.
    await screen.unmount();
    allowSource = false;
    sourcePending = false;
    evaluated = Promise.withResolvers<void>();
    started = performance.now();
    rejectSource = undefined;
    const previousSettlements = settlements;
    activeScreen = await render(<Fixture masks={registry} masked={false} />);
    await evaluated.promise;
    console.info("facial-grey-unmasked-source-loader-evaluated", performance.now() - started);
    await expect.poll(() => sourcePending).toBe(true);
    const unmaskedMesh = card();
    rejectCurrentSource("controlled initially unmasked source rejection");
    await expect
      .poll(() =>
        errors.some((error) =>
          error.message.includes("controlled initially unmasked source rejection"),
        ),
      )
      .toBe(true);
    await expect.poll(() => settlements).toBeGreaterThan(previousSettlements);
    expect((card().material as HairMaterial).map).toBeNull();
    expect(card().visible).toBe(true);
    const activationSettlements = settlements;
    allowSource = true;
    await activeScreen.rerender(<Fixture masks={registry} />);
    await expect.poll(() => settlements).toBeGreaterThan(activationSettlements);
    expect(card()).toBe(unmaskedMesh);
    expect(card().visible).toBe(true);
    expect((card().material as HairMaterial).map).not.toBeNull();
    expect(settledMaps.at(-1)).toBe(true);
  } finally {
    await activeScreen.unmount();
    loading.mockRestore();
    client.dispose();
  }
}, 120_000);
