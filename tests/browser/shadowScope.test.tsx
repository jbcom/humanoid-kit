/**
 * The kit's shadow filter changes nothing outside the kit (`render/shadowFilter.ts`,
 * `docs/ARCHITECTURE.md`, "The key light's shadow"). A game that puts a figure on its
 * board draws the board with its own sun, a directional light with its own fitted shadow,
 * on its own materials; the stage's key light and the tent it reads its shadow through
 * must not reach them. three's shadow-read code is one shared `ShaderChunk`, so a filter
 * that replaced it would change every lit material in the host app.
 *
 * The gates:
 * - a scene with a non-kit directional light casting onto a plain `MeshStandardMaterial`
 *   draws the same pixels with the kit's key light mounted as without the kit, to the bit
 *   (against a stock light in the key's place, which makes the shader the same one) and to
 *   within a float's ulp (against no second light);
 * - the mounted `<StudioStage>` leaves every `ShaderChunk` as three ships it;
 * - and the filter is not vacuous: a material that opts in (`applyShadowFilter`) and the
 *   kit's `SkinMaterial` do read the tent, and draw a different shadow from three's.
 *
 * The scene is lit by the host's sun alone (and a little ambient). The kit's key light
 * is the stage's own (`configureKeyShadow`, fitted by `keyShadowFitter`) at intensity 0,
 * so the light it adds is exactly nothing and what is left to differ is how the host's
 * shadow is read. Each scene is drawn on a renderer of its own, because three caches a
 * program by its parameters, not its source: a program an earlier render compiled would be
 * reused and hide a filter that arrived later. The references are drawn first, in
 * `beforeAll`, before the kit has run anything in this file.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  FloatType,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderChunk,
  Vector3,
  WebGLRenderTarget,
} from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { STUDIO_SHADOWS, StudioStage } from "../../src/react/index.ts";
import { applyShadowFilter, SHADOW_FILTER_MARK } from "../../src/render/shadowFilter.ts";
import { SkinMaterial } from "../../src/render/skinMaterial.ts";
import {
  configureKeyShadow,
  KEY_POSITION,
  keyShadowFitter,
  RIM_INTENSITY,
  RIM_POSITION,
  RIM_SHADOW_RADIUS,
  STUDIO_SHADOW_MAP_TYPE,
} from "../../src/render/studioShadow.ts";
import { createTestRenderer } from "./gl.ts";

/** Every ShaderChunk three ships, taken before this file mounts anything of the kit's. */
const STOCK_CHUNKS = { ...ShaderChunk };

const SIZE = 256;
/** The host sun's filter radii: three's default (the case a library most easily clobbers) and a wide one. */
const RADII = [1, 6] as const;

const targets: WebGLRenderTarget[] = [];
const disposables: { dispose(): void }[] = [];
afterAll(() => {
  for (const t of targets) t.dispose();
  for (const d of disposables) d.dispose();
});

function newRenderer() {
  const renderer = createTestRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = STUDIO_SHADOW_MAP_TYPE;
  renderer.toneMapping = NoToneMapping;
  return renderer;
}

type Renderer = ReturnType<typeof newRenderer>;

/** Straight down onto the board, 4 m across. */
function topDown(): OrthographicCamera {
  const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
  camera.position.set(0, 8, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  return camera;
}

/**
 * The second shadow-casting light in the scene, besides the host's sun:
 * - `none`: no second light, the host's scene as it is;
 * - `plain`: a stock three directional light at the key's place, intensity 0, casting a
 *   shadow, with nothing of the kit's done to it: the same lights and so the same programs
 *   as `kit`, which is what lets a comparison against it be exact;
 * - `kit`: the stage's key light, set up and fitted as `<StudioStage>` does, at intensity 0.
 */
type SecondLight = "none" | "plain" | "kit";

interface Options {
  /** The host sun's `shadow.radius`. */
  radius: number;
  second: SecondLight;
  /** The material the board is drawn with; a plain `MeshStandardMaterial` unless given. */
  board?: () => MeshStandardMaterial;
}

/** The host app's scene: a board, a block on it, and its own sun with its own fitted shadow. */
function hostScene({ radius, second, board }: Options): Scene {
  const scene = new Scene();
  scene.background = new Color(0);
  scene.add(new AmbientLight("#ffffff", 0.15));
  const sun = new DirectionalLight("#ffffff", 2.2);
  sun.position.set(-2.5, 4, 1.5);
  sun.castShadow = true;
  const cam = sun.shadow.camera;
  cam.left = -2.4;
  cam.right = 2.4;
  cam.top = 2.4;
  cam.bottom = -2.4;
  cam.near = 0.5;
  cam.far = 14;
  cam.updateProjectionMatrix();
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.radius = radius;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const ground = new Mesh(new PlaneGeometry(4, 4), board?.() ?? new MeshStandardMaterial());
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  const block = new Mesh(new BoxGeometry(0.7, 0.9, 0.7), new MeshStandardMaterial());
  block.position.set(0.2, 0.45, 0);
  block.castShadow = true;
  block.receiveShadow = true;
  scene.add(ground, block);
  for (const m of [ground, block]) {
    disposables.push(m.geometry, m.material as MeshStandardMaterial);
  }
  disposables.push(sun.shadow);
  if (second !== "none") {
    // It adds no light of its own: what differs is only how the sun's shadow is read.
    const key = new DirectionalLight("#fff6ef", 0);
    key.position.set(...KEY_POSITION);
    key.castShadow = true;
    if (second === "kit") configureKeyShadow(key);
    scene.add(key, key.target);
    if (second === "kit") keyShadowFitter()(key, scene);
    disposables.push(key.shadow);
  }
  return scene;
}

/** The scene's pixels, four floats each. */
function pixels(renderer: Renderer, scene: Scene): Float32Array {
  const target = new WebGLRenderTarget(SIZE, SIZE, { type: FloatType });
  targets.push(target);
  renderer.setRenderTarget(target);
  renderer.render(scene, topDown());
  const px = new Float32Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, px);
  renderer.setRenderTarget(null);
  return px;
}

function maxDifference(a: Float32Array, b: Float32Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++)
    worst = Math.max(worst, Math.abs((a[i] as number) - (b[i] as number)));
  return worst;
}

/** The shadow is there: the board's darkest pixels are well under its brightest. */
function expectShadowed(px: Float32Array): void {
  let lo = Number.POSITIVE_INFINITY;
  let hi = 0;
  for (let i = 0; i < px.length; i += 4) {
    const lum = px[i] as number;
    lo = Math.min(lo, lum);
    hi = Math.max(hi, lum);
  }
  expect(hi, "the board is lit").toBeGreaterThan(0.2);
  expect(lo, "and the block shadows it").toBeLessThan(0.5 * hi);
}

/**
 * What the host's scene draws before anything of the kit's has run in this file (a
 * `configureKeyShadow` call, or a material of the kit's compiling), per sun radius and
 * second light. This runs first so that the reference is three's own.
 */
const baseline = new Map<string, Float32Array>();
const slot = (radius: number, second: SecondLight) => `${radius}/${second}`;
beforeAll(() => {
  const renderer = newRenderer();
  for (const radius of RADII)
    for (const second of ["none", "plain"] as const) {
      const px = pixels(renderer, hostScene({ radius, second }));
      expectShadowed(px);
      baseline.set(slot(radius, second), px);
    }
});
const reference = (radius: number, second: SecondLight) =>
  baseline.get(slot(radius, second)) as Float32Array;

/**
 * Another light in the scene, even one of intensity 0, is another term in the shader's
 * sum, which moves a float by at most an ulp (6e-8 here): 4000 times under one step of an
 * 8-bit display. The comparison against `none` is held to a hundredth of that step.
 */
const ULP_BOUND = 4e-5;

describe("the host's own light and materials, with the kit's stage mounted", () => {
  for (const radius of RADII) {
    it(`a non-kit sun (radius ${radius}) casts onto a plain MeshStandardMaterial bit for bit as it does beside a stock light`, () => {
      const withKit = pixels(newRenderer(), hostScene({ radius, second: "kit" }));
      expect(maxDifference(withKit, reference(radius, "plain"))).toBe(0);
    });

    it(`and as it does without the kit's stage at all (sun radius ${radius}), to within a float's ulp`, () => {
      const withKit = pixels(newRenderer(), hostScene({ radius, second: "kit" }));
      expect(maxDifference(withKit, reference(radius, "none"))).toBeLessThan(ULP_BOUND);
    });
  }

  it("the reference is stable: the same scene on a fresh renderer repeats it", () => {
    const again = pixels(newRenderer(), hostScene({ radius: 6, second: "plain" }));
    expect(maxDifference(again, reference(6, "plain"))).toBe(0);
  });
});

describe("the kit's materials do read the tent", () => {
  it("a material that opts in draws the wide sun's shadow differently from three's own read", () => {
    const opted = pixels(
      newRenderer(),
      hostScene({
        radius: 6,
        second: "kit",
        board: () => applyShadowFilter(new MeshStandardMaterial()),
      }),
    );
    expectShadowed(opted);
    // The tent is wider and smoother than three's five reads on a disc at the same radius.
    expect(maxDifference(opted, reference(6, "plain"))).toBeGreaterThan(0.02);
  });

  it("an opted-in material at the default radius is a single bilinear compare, not three's PCF", () => {
    const opted = pixels(
      newRenderer(),
      hostScene({
        radius: 1,
        second: "plain",
        board: () => applyShadowFilter(new MeshStandardMaterial()),
      }),
    );
    expectShadowed(opted);
    expect(maxDifference(opted, reference(1, "plain"))).toBeGreaterThan(0);
  });

  it("SkinMaterial compiles with the tent and is shadowed by the host's sun", () => {
    const renderer = newRenderer();
    const seen: string[] = [];
    const skin = new SkinMaterial();
    const own = skin.onBeforeCompile;
    skin.onBeforeCompile = (shader, r) => {
      own.call(skin, shader, r);
      seen.push(shader.fragmentShader);
    };
    const px = pixels(
      renderer,
      hostScene({ radius: 6, second: "kit", board: () => skin as unknown as MeshStandardMaterial }),
    );
    expect(seen.length).toBeGreaterThan(0);
    for (const fragment of seen) expect(fragment).toContain(SHADOW_FILTER_MARK);
    expectShadowed(px);
  });

  it("a stock MeshPhysicalMaterial in the same scene is untouched by the kit's materials", () => {
    const withKit = pixels(
      newRenderer(),
      hostScene({ radius: 6, second: "kit", board: () => new MeshPhysicalMaterial() }),
    );
    const beside = pixels(
      newRenderer(),
      hostScene({ radius: 6, second: "plain", board: () => new MeshPhysicalMaterial() }),
    );
    expect(maxDifference(withKit, beside)).toBe(0);
  });
});

describe("<StudioStage>", () => {
  it("leaves every ShaderChunk as three ships it once mounted and drawing", async () => {
    let frames = 0;
    let draws = 0;
    function FrameWitness() {
      const advance = useThree((state) => state.advance);
      useEffect(() => {
        // Demand invalidation is RAF-scheduled and can coalesce in this browser
        // fixture. `advance` is R3F's public manual-render API, so the fixture
        // drives exactly six late-mount frames and then stops; production keeps
        // its own loop.
        const start = performance.now();
        for (let frame = 0; frame < 6; frame++) advance(start + frame);
      }, [advance]);
      useFrame(() => {
        // useFrame runs before the renderer; the mesh's onAfterRender below is
        // the paired proof that every manual frame really drew.
        frames++;
      });
      return null;
    }
    await render(
      <div style={{ width: 160, height: 160 }}>
        <Canvas frameloop="never" shadows={STUDIO_SHADOWS} camera={{ position: [0, 1.5, 4] }}>
          <StudioStage />
          <FrameWitness />
          <mesh
            position={[0, 0.5, 0]}
            castShadow
            receiveShadow
            onAfterRender={() => {
              draws++;
            }}
          >
            <boxGeometry />
            <meshStandardMaterial />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} receiveShadow>
            <planeGeometry args={[6, 6]} />
            <meshStandardMaterial />
          </mesh>
        </Canvas>
      </div>,
    );
    await expect.poll(() => Math.min(frames, draws)).toBeGreaterThan(5);
    expect(Object.keys(ShaderChunk).sort()).toEqual(Object.keys(STOCK_CHUNKS).sort());
    for (const [name, source] of Object.entries(STOCK_CHUNKS))
      expect(ShaderChunk[name as keyof typeof ShaderChunk], name).toBe(source);
    expect(ShaderChunk.shadowmap_pars_fragment).not.toContain(SHADOW_FILTER_MARK);
  });

  it("casts the rim light's shadow too, so it cannot paint the hollows the form covers", async () => {
    let scene: Scene | null = null;
    function Probe() {
      scene = useThree((s) => s.scene);
      return null;
    }
    await render(
      <div style={{ width: 160, height: 160 }}>
        <Canvas shadows={STUDIO_SHADOWS} camera={{ position: [0, 1.5, 4] }}>
          <StudioStage />
          <Probe />
        </Canvas>
      </div>,
    );
    await expect.poll(() => scene).not.toBeNull();
    const rims: DirectionalLight[] = [];
    (scene as unknown as Scene).traverse((o) => {
      const light = o as DirectionalLight;
      if (
        light.isDirectionalLight &&
        light.position.distanceTo(new Vector3(...RIM_POSITION)) < 1e-6
      )
        rims.push(light);
    });
    expect(rims).toHaveLength(1);
    const rim = rims[0] as DirectionalLight;
    expect(rim.castShadow).toBe(true);
    expect(rim.intensity).toBeCloseTo(RIM_INTENSITY, 9);
    expect(rim.shadow.radius).toBeLessThanOrEqual(RIM_SHADOW_RADIUS);
  });
});
