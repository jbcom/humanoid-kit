/**
 * The studio key light's shadow where one part of a body shadows another at a
 * grazing angle (`render/studioShadow.ts`): a thigh beside the groin, the back of
 * a knee, the crease under a buttock. There a shadow-map texel is stretched along
 * the skin by the angle, so an edge drawn from texels unfiltered, or from a filter
 * that breaks down where occluder and receiver nearly touch, is a staircase of
 * light and dark wedges several pixels long.
 *
 * The scene stands in for a body at such a place: a thick slab (the receiving skin,
 * a closed solid that casts as well, as the body does) tilted until the key light
 * grazes it, and a cylinder (a limb) lying a few millimetres to a few centimetres
 * off it, its axis turned 8° within the slab off the shadow map's rows, which the
 * graze foreshortens to a few degrees in the map: nearly along them, where a map's
 * staircase has its longest, tallest steps. An orthographic camera looks straight
 * down onto the slab at a close-up's scale; the cylinder is invisible to it but
 * casts. Each row of the image crosses the shadow's band, and where the luminance
 * crosses halfway between the shadowed and the lit skin is the edge's position on
 * that row.
 *
 * The staircase is what is left of those positions after a running mean along the
 * edge over one target penumbra: a softbox's shadow carries no detail along its
 * edge finer than its own penumbra, so anything that fine is the map's. Its bound
 * is a share of the penumbra across the edge, as it falls on the receiver.
 *
 * The acne checks light a convex solid (a sphere) and a concave one (a thick bowl
 * facing the light, so nothing shades its inside): nothing occludes either, so the
 * shadowed render must match the one with shadows off wherever the key reaches.
 */
import {
  AmbientLight,
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  FloatType,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  NoToneMapping,
  type Object3D,
  OrthographicCamera,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from "three";
import { afterAll, describe, expect, it } from "vitest";
import {
  configureKeyShadow,
  KEY_POSITION as KEY_AT,
  KEY_SHADOW,
  keyShadowFitter,
  STUDIO_SHADOW_MAP_TYPE,
} from "../../src/render/studioShadow.ts";
import { createTestRenderer } from "./gl.ts";

/** Where the stage's key light stands, aimed at the origin. */
const KEY_POSITION = new Vector3(...KEY_AT);
/** The penumbra the stage is tuned for, 10 % to 90 %, on skin facing the light. */
const TARGET_PENUMBRA = KEY_SHADOW.penumbra;
/** A close-up's scale: half a millimetre a pixel (a 20 cm crop of thighs over 400 px). */
const METRES_PER_PIXEL = 0.0005;
/**
 * A staircase is invisible when it moves the edge by a small part of the edge's
 * own width: at most 2 % of the target penumbra, as it falls on the receiver. Where
 * the edge is steepest (a tent's middle, 1.1 / penumbra of the shadow's depth per
 * unit) that changes the shadow by about 2 % of its depth: under the stage's fill,
 * about 1 % of lit skin's luminance. One unfiltered texel of the variance map this
 * replaced (1.4 mm) is 9 % of the penumbra.
 */
const STAIRCASE_SHARE = 0.02;

const renderer = createTestRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = STUDIO_SHADOW_MAP_TYPE;
renderer.toneMapping = NoToneMapping;
const targets: WebGLRenderTarget[] = [];
afterAll(() => {
  for (const t of targets) t.dispose();
});

const skin = () => new MeshPhysicalMaterial({ color: "#c68e6e", roughness: 0.5 });
/** Casts, but the camera sees through it: the shadow pass does not use its material. */
const unseen = () => new MeshPhysicalMaterial({ colorWrite: false, depthWrite: false });

/** A scene lit by the stage's key light alone (and a little ambient, so a shadow is not black). */
function keyLitScene(): { scene: Scene; key: DirectionalLight } {
  const scene = new Scene();
  scene.background = new Color(0);
  const key = new DirectionalLight("#fff6ef", 2.4);
  key.position.copy(KEY_POSITION);
  key.castShadow = true;
  configureKeyShadow(key);
  scene.add(key, key.target, new AmbientLight("#ffffff", 0.1));
  return { scene, key };
}

/** Places `object` so its local x, y, z axes are `x`, `y`, `z` and its origin `at`. */
function place(object: Object3D, x: Vector3, y: Vector3, z: Vector3, at: Vector3): void {
  object.matrixAutoUpdate = false;
  object.matrix.makeBasis(x, y, z).setPosition(at);
  object.updateMatrixWorld(true);
}

/**
 * Luminance per pixel (row 0 at the bottom) of `scene` through `camera`, the key's
 * shadow fitted to the scene's casters first, as the stage fits it before each frame.
 */
function renderLuminance(
  scene: Scene,
  key: DirectionalLight,
  camera: OrthographicCamera,
  width: number,
  height: number,
): Float32Array {
  keyShadowFitter()(key, scene);
  const target = new WebGLRenderTarget(width, height, { type: FloatType });
  targets.push(target);
  renderer.setSize(width, height, false);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const px = new Float32Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, px);
  renderer.setRenderTarget(null);
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++)
    lum[i] =
      0.2126 * (px[4 * i] as number) +
      0.7152 * (px[4 * i + 1] as number) +
      0.0722 * (px[4 * i + 2] as number);
  return lum;
}

function disposeScene(scene: Scene, key: DirectionalLight): void {
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    (mesh.geometry as BufferGeometry).dispose();
    (mesh.material as MeshPhysicalMaterial).dispose();
  });
  key.shadow.dispose();
}

/** Where along `row` (a profile from lit through shadow to lit) the luminance first falls to `level`, from `from` stepping by `step`. */
function crossing(row: ArrayLike<number>, level: number, from: number, step: 1 | -1): number {
  for (let x = from + step; x >= 0 && x < row.length; x += step) {
    const a = row[x - step] as number;
    const b = row[x] as number;
    if ((a - level) * (b - level) <= 0 && a !== b) return x - step + (step * (a - level)) / (a - b);
  }
  return Number.NaN;
}

/**
 * What is left of `ys` after a centred running mean over `window` samples (odd), where
 * the window fits: its detail finer than the window. A straight line leaves nothing.
 */
function highPass(ys: number[], window: number): number[] {
  const half = (window - 1) / 2;
  const out: number[] = [];
  for (let i = half; i < ys.length - half; i++) {
    let sum = 0;
    for (let k = i - half; k <= i + half; k++) sum += ys[k] as number;
    out.push((ys[i] as number) - sum / window);
  }
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
};

interface Edge {
  /** The 10 % to 90 % width of the edge across it, in pixels (the median over the rows). */
  penumbra: number;
  /** The largest detail of either edge finer than the target penumbra along it, in pixels. */
  staircase: number;
  /** The target penumbra as it falls on this receiver, in pixels. */
  targetPenumbra: number;
}

/**
 * The edges of the shadow a cylinder `gap` metres off a slab casts when the key
 * light meets the slab at `graze` degrees.
 */
function grazingEdge(gap: number, graze: number): Edge {
  const { scene, key } = keyLitScene();
  const g = (graze * Math.PI) / 180;
  const toLight = KEY_POSITION.clone().normalize();
  // Across the light (horizontal), and the third axis, perpendicular to both.
  const across = new Vector3().crossVectors(toLight, new Vector3(0, 1, 0)).normalize();
  const third = new Vector3().crossVectors(toLight, across).normalize();
  // The slab's normal meets the light at 90° - graze; `across` lies in the slab.
  const normal = toLight
    .clone()
    .multiplyScalar(Math.sin(g))
    .addScaledVector(third, Math.cos(g))
    .normalize();
  const downSlab = new Vector3().crossVectors(normal, across).normalize();
  const slab = new Mesh(new BoxGeometry(1.2, 0.03, 1.2), skin());
  slab.castShadow = true;
  slab.receiveShadow = true;
  place(
    slab,
    across,
    normal,
    new Vector3().crossVectors(across, normal),
    normal.clone().multiplyScalar(-0.015),
  );
  // The limb, its axis 8° off `across` (the shadow map's rows) within the slab.
  const radius = 0.04;
  const turn = (8 * Math.PI) / 180;
  const axis = across
    .clone()
    .multiplyScalar(Math.cos(turn))
    .addScaledVector(downSlab, Math.sin(turn))
    .normalize();
  const limb = new Mesh(new CylinderGeometry(radius, radius, 0.8, 96, 1), unseen());
  limb.castShadow = true;
  const centre = normal.clone().multiplyScalar(gap + radius);
  place(limb, normal, axis, new Vector3().crossVectors(normal, axis), centre);
  scene.add(slab, limb);
  // Where the limb's shadow falls on the slab: its centre, carried along the light.
  const shadowAt = centre.clone().addScaledVector(toLight, -(gap + radius) / Math.sin(g));
  const width = 800;
  const height = 400;
  const camera = new OrthographicCamera(
    (-width * METRES_PER_PIXEL) / 2,
    (width * METRES_PER_PIXEL) / 2,
    (height * METRES_PER_PIXEL) / 2,
    (-height * METRES_PER_PIXEL) / 2,
    0.1,
    3,
  );
  camera.position.copy(shadowAt).addScaledVector(normal, 1);
  camera.up.copy(axis);
  camera.lookAt(shadowAt);
  camera.updateMatrixWorld(true);
  const lum = renderLuminance(scene, key, camera, width, height);
  disposeScene(scene, key);

  const lefts: number[] = [];
  const rights: number[] = [];
  const widths: number[] = [];
  for (let y = 0; y < height; y++) {
    const row = lum.subarray(y * width, (y + 1) * width);
    const sorted = [...row].sort((a, b) => a - b);
    const dark = sorted[Math.floor(0.03 * width)] as number;
    const lit = sorted[Math.floor(0.97 * width)] as number;
    expect(lit, "the slab is lit beside the shadow").toBeGreaterThan(2 * dark);
    const level = (f: number) => dark + f * (lit - dark);
    // From the left edge of the frame (lit) into the band, and from the right.
    lefts.push(crossing(row, level(0.5), 0, 1));
    rights.push(crossing(row, level(0.5), width - 1, -1));
    widths.push(crossing(row, level(0.1), 0, 1) - crossing(row, level(0.9), 0, 1));
    widths.push(
      crossing(row, level(0.9), width - 1, -1) - crossing(row, level(0.1), width - 1, -1),
    );
  }
  for (const xs of [lefts, rights, widths])
    expect(xs.every(Number.isFinite), "every row crosses both edges").toBe(true);
  // Rows lie along the edge, a pixel apart: the running mean spans one target penumbra of them.
  const window = 2 * Math.round(TARGET_PENUMBRA / METRES_PER_PIXEL / 2) + 1;
  const staircase = Math.max(
    ...highPass(lefts, window).map(Math.abs),
    ...highPass(rights, window).map(Math.abs),
  );
  return {
    penumbra: median(widths),
    staircase,
    targetPenumbra: TARGET_PENUMBRA / Math.sin(g) / METRES_PER_PIXEL,
  };
}

interface Acne {
  /** Pixels the key reaches (beyond `minLit` of its full strength) that were measured. */
  measured: number;
  /** Of those, the share darker than 97 % of the unshadowed render. */
  speckled: number;
  /** The darkest ratio of shadowed to unshadowed among them. */
  darkest: number;
}

/**
 * Renders `solid` (the only thing in the scene, so nothing occludes it) with its
 * shadow cast and without, and compares them where `reached` says the key reaches.
 */
function selfShadow(
  solid: Mesh,
  view: Vector3,
  span: number,
  reached: (p: Vector2) => boolean,
): Acne {
  const { scene, key } = keyLitScene();
  solid.receiveShadow = true;
  scene.add(solid);
  const size = 320;
  const camera = new OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, 0.1, 6);
  camera.position.copy(view).setLength(3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  solid.castShadow = true;
  const shadowed = renderLuminance(scene, key, camera, size, size);
  solid.castShadow = false;
  const open = renderLuminance(scene, key, camera, size, size);
  disposeScene(scene, key);
  let measured = 0;
  let speckled = 0;
  let darkest = 1;
  const p = new Vector2();
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // The pixel's centre on the camera's plane, in metres from the axis.
      p.set(((x + 0.5) / size - 0.5) * span, ((y + 0.5) / size - 0.5) * span);
      if (!reached(p)) continue;
      const i = y * size + x;
      const ratio = (shadowed[i] as number) / Math.max(open[i] as number, 1e-6);
      measured++;
      if (ratio < 0.97) speckled++;
      darkest = Math.min(darkest, ratio);
    }
  return { measured, speckled: speckled / Math.max(measured, 1), darkest };
}

describe("the key light's shadow where a body shadows itself at a grazing angle", () => {
  for (const gap of [0.004, 0.03])
    for (const graze of [15, 30])
      it(`casts a smooth edge, not a staircase: a limb ${gap * 1000} mm off skin the light grazes at ${graze}°`, () => {
        const edge = grazingEdge(gap, graze);
        const what = `penumbra ${edge.penumbra.toFixed(1)} px, staircase ${edge.staircase.toFixed(2)} px (${((100 * edge.staircase) / edge.targetPenumbra).toFixed(1)} % of the target penumbra, ${edge.targetPenumbra.toFixed(1)} px)`;
        console.log(`grazing edge, gap ${gap * 1000} mm, graze ${graze}°: ${what}`);
        // Soft: at least half the target, so the filter is working where the parts nearly touch.
        expect(edge.penumbra, what).toBeGreaterThan(0.5 * edge.targetPenumbra);
        expect(edge.staircase, what).toBeLessThan(STAIRCASE_SHARE * edge.targetPenumbra);
      });
});

describe("the key light's shadow on skin nothing occludes (acne)", () => {
  const toLight = KEY_POSITION.clone().normalize();

  it("leaves a lit convex surface unspeckled, to where the light grazes it", () => {
    const radius = 0.12;
    const sphere = new Mesh(new SphereGeometry(radius, 96, 64), skin());
    // Seen from 70° off the light, so the terminator is broad in the frame.
    const across = new Vector3().crossVectors(toLight, new Vector3(0, 1, 0)).normalize();
    const view = toLight.clone().applyAxisAngle(across, (70 * Math.PI) / 180);
    const camera = new OrthographicCamera();
    camera.position.copy(view);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const back = new Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
    // The sphere's normal under each pixel, and how squarely the key meets it there.
    const reached = (p: Vector2) => {
      const r2 = (p.x * p.x + p.y * p.y) / (radius * radius);
      if (r2 >= 0.97) return false;
      const n = right
        .clone()
        .multiplyScalar(p.x / radius)
        .addScaledVector(up, p.y / radius)
        .addScaledVector(back, Math.sqrt(1 - r2));
      return n.dot(toLight) > 0.2;
    };
    const acne = selfShadow(sphere, view, 2.4 * radius, reached);
    const what = `${acne.measured} px measured, ${(100 * acne.speckled).toFixed(2)} % speckled, darkest ${acne.darkest.toFixed(3)}`;
    expect(acne.measured, what).toBeGreaterThan(20_000);
    expect(acne.speckled, what).toBeLessThan(0.001);
    expect(acne.darkest, what).toBeGreaterThan(0.9);
  });

  it("leaves a lit concave surface unspeckled: a bowl facing the light", () => {
    // A thick bowl: a closed profile turned about its axis (y), its hollow 20 cm across and 4 cm deep.
    const inner = 0.1;
    const depth = 0.04;
    const profile: Vector2[] = [];
    const steps = 48;
    // The hollow, from the centre out to the rim, on a sphere through both.
    const sphereR = (inner * inner + depth * depth) / (2 * depth);
    for (let i = 0; i <= steps; i++) {
      const r = (inner * i) / steps;
      profile.push(new Vector2(r, sphereR - Math.sqrt(sphereR * sphereR - r * r)));
    }
    // The rim, and the outside back to the axis below.
    profile.push(new Vector2(inner + 0.02, depth), new Vector2(inner + 0.02, -0.02));
    profile.push(new Vector2(0.0001, -0.02));
    const bowl = new Mesh(new LatheGeometry(profile.reverse(), 128), skin());
    // Its hollow opens toward the light.
    const y = toLight.clone();
    const x = new Vector3().crossVectors(y, new Vector3(0, 0, 1)).normalize();
    place(bowl, x, y, new Vector3().crossVectors(x, y), new Vector3());
    // Seen from 35° off the light, into the hollow. Measured within a circle the hollow
    // fills from any direction of the turn: half its radius, foreshortened by the turn.
    const turn = (35 * Math.PI) / 180;
    const view = toLight.clone().applyAxisAngle(x, turn);
    const within = 0.5 * inner * Math.cos(turn);
    const reached = (p: Vector2) => p.lengthSq() < within * within;
    const acne = selfShadow(bowl, view, 0.3, reached);
    const what = `${acne.measured} px measured, ${(100 * acne.speckled).toFixed(2)} % speckled, darkest ${acne.darkest.toFixed(3)}`;
    expect(acne.measured, what).toBeGreaterThan(4_000);
    expect(acne.speckled, what).toBeLessThan(0.001);
    expect(acne.darkest, what).toBeGreaterThan(0.9);
  });
});
