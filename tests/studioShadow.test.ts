/**
 * Framing the studio key light's shadow map (`render/studioShadow.ts`): what the
 * window covers, how big the map is, and that a figure moving under it neither
 * swims (the window stays on the texel's grid) nor reallocates the map. The
 * filter's own look is measured in the browser (`tests/browser/skinShadow.test.ts`,
 * `tests/browser/shadowEdge.test.ts`).
 */
import {
  Bone,
  Box3,
  BoxGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderChunk,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";
import { installShadowFilter, shadowFilterInstalled } from "../src/render/shadowFilter.ts";
import {
  applyKeyShadowFrame,
  casterBounds,
  configureKeyShadow,
  frameKeyShadow,
  KEY_POSITION,
  KEY_SHADOW,
  type KeyShadowFrame,
  keyShadowFitter,
  keyShadowTexel,
} from "../src/render/studioShadow.ts";

/** A box in the light's view space (the light looks down -z). */
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
  new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1));

/** A standing figure as the key sees it: about a metre across, two high, four and a half metres off. */
const figure = (dx = 0) => box(-0.45 + dx, -1.0, -5.0, 0.45 + dx, 1.0, -4.2);

const onGrid = (v: number, texel: number) => Math.abs(v / texel - Math.round(v / texel)) < 1e-6;

const key = () => {
  const light = new DirectionalLight();
  light.position.set(...KEY_POSITION);
  return light;
};

describe("frameKeyShadow", () => {
  it("covers the casters and their margin at the key's texel, on its grid", () => {
    const f = frameKeyShadow(figure());
    expect(f.texel).toBe(keyShadowTexel());
    expect(f.radius).toBe(KEY_SHADOW.radius);
    expect(f.left).toBeLessThanOrEqual(-0.45 - KEY_SHADOW.margin);
    expect(f.right).toBeGreaterThanOrEqual(0.45 + KEY_SHADOW.margin);
    expect(f.bottom).toBeLessThanOrEqual(-1 - KEY_SHADOW.margin);
    expect(f.top).toBeGreaterThanOrEqual(1 + KEY_SHADOW.margin);
    for (const edge of [f.left, f.right, f.bottom, f.top]) expect(onGrid(edge, f.texel)).toBe(true);
    // The window is exactly the map: a texel is `texel` metres on both axes.
    expect((f.right - f.left) / f.mapWidth).toBeCloseTo(f.texel, 12);
    expect((f.top - f.bottom) / f.mapHeight).toBeCloseTo(f.texel, 12);
    // Depth: the casters with room in front and behind, the near plane toward the light.
    expect(f.near).toBeCloseTo(4.2 - KEY_SHADOW.depthMargin, 9);
    expect(f.far).toBeCloseTo(5 + KEY_SHADOW.depthMargin, 9);
  });

  it("costs one figure a map well under the cap, its sides whole steps", () => {
    const f = frameKeyShadow(figure());
    expect(f.mapWidth % KEY_SHADOW.mapStep).toBe(0);
    expect(f.mapHeight % KEY_SHADOW.mapStep).toBe(0);
    // 1 m by 2.1 m at 1.2 mm a texel.
    expect(f.mapWidth).toBe(896);
    expect(f.mapHeight).toBe(1792);
  });

  it("draws the same penumbra through a narrower tent with a coarser texel: a third of the radius, three times the texel", () => {
    const phone = frameKeyShadow(figure(), null, { radius: 4 });
    expect(phone.radius).toBe(4);
    expect(phone.texel).toBeCloseTo((KEY_SHADOW.radius / 4) * keyShadowTexel(), 12);
    expect(phone.mapWidth).toBe(384);
    // The radius is a whole number of texels, 1 to 16.
    expect(frameKeyShadow(figure(), null, { radius: 20 }).radius).toBe(16);
    expect(frameKeyShadow(figure(), null, { radius: 0 }).radius).toBe(1);
  });

  it("keeps the grid and the map's size as the figure moves, so its shadow neither swims nor reallocates", () => {
    let previous: KeyShadowFrame = frameKeyShadow(figure());
    const first = previous;
    for (let i = 1; i <= 50; i++) {
      // A walk across the map, a millimetre at a time (less than a texel).
      const f = frameKeyShadow(figure(i * 0.001), previous);
      expect(f.texel).toBe(first.texel);
      expect(onGrid(f.left, f.texel)).toBe(true);
      expect(f.mapWidth).toBe(first.mapWidth);
      expect(f.mapHeight).toBe(first.mapHeight);
      expect(f.right).toBeGreaterThanOrEqual(0.45 + i * 0.001 + KEY_SHADOW.margin);
      previous = f;
    }
  });

  it("shrinks the map once the casters need two steps fewer", () => {
    const wide = frameKeyShadow(box(-1.1, -1, -5, 1.1, 1, -4));
    expect(wide.texel).toBe(keyShadowTexel());
    const narrow = frameKeyShadow(figure(), wide);
    expect(narrow.mapWidth).toBeLessThan(wide.mapWidth);
    expect(narrow.mapHeight).toBe(wide.mapHeight);
  });

  it("caps a crowd's map and coarsens the texel instead, by eighths of an octave", () => {
    const crowd = box(-6, -1, -8, 6, 1, -2);
    const f = frameKeyShadow(crowd);
    expect(f.mapWidth).toBeLessThanOrEqual(KEY_SHADOW.maxMapSize);
    expect(f.right - f.left).toBeGreaterThanOrEqual(12 + 2 * KEY_SHADOW.margin);
    const octaves = Math.log2(f.texel / keyShadowTexel());
    expect(octaves).toBeGreaterThan(0);
    expect(Math.abs(8 * octaves - Math.round(8 * octaves))).toBeLessThan(1e-9);
    // A phone's cap of 1024 halves the map and doubles the texel, near enough.
    const phone = frameKeyShadow(crowd, null, { maxMapSize: 1024 });
    expect(phone.mapWidth).toBeLessThanOrEqual(1024);
    expect(phone.texel / f.texel).toBeGreaterThan(1.8);
    expect(phone.texel / f.texel).toBeLessThan(2.2);
  });
});

describe("casterBounds", () => {
  it("bounds what casts and is visible, in the light's view space", () => {
    const light = key();
    const scene = new Group();
    const caster = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicMaterial());
    caster.castShadow = true;
    caster.position.set(3, 0, 0);
    const notCasting = new Mesh(new BoxGeometry(10, 10, 10), new MeshBasicMaterial());
    const hidden = new Mesh(new BoxGeometry(10, 10, 10), new MeshBasicMaterial());
    hidden.castShadow = true;
    hidden.visible = false;
    scene.add(caster, notCasting, hidden);
    scene.updateMatrixWorld(true);
    const bounds = casterBounds(scene, light, new Box3());
    const size = bounds.getSize(new Vector3());
    // A 20 cm cube seen from any direction spans at most its diagonal, at least its side.
    for (const s of [size.x, size.y, size.z]) {
      expect(s).toBeGreaterThan(0.2 - 1e-9);
      expect(s).toBeLessThan(0.2 * Math.sqrt(3) + 1e-9);
    }
    // Its centre is where the cube is, seen from the light.
    const centre = bounds.getCenter(new Vector3()).applyMatrix4(light.shadow.camera.matrixWorld);
    expect(centre.distanceTo(new Vector3(3, 0, 0))).toBeLessThan(1e-6);
  });

  it("is empty when nothing casts", () => {
    const scene = new Group();
    scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    expect(casterBounds(scene, key(), new Box3()).isEmpty()).toBe(true);
  });

  it("covers a skinned mesh's bones with their reach, wherever an animation has swung them", () => {
    const light = key();
    const geometry = new BoxGeometry(0.1, 0.1, 0.1);
    const count = geometry.getAttribute("position").count;
    geometry.setAttribute("skinIndex", new Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
    geometry.setAttribute(
      "skinWeight",
      new Float32BufferAttribute(
        Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)),
        4,
      ),
    );
    const root = new Bone();
    const hand = new Bone();
    root.add(hand);
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
    mesh.castShadow = true;
    mesh.add(root);
    mesh.updateMatrixWorld(true);
    mesh.bind(new Skeleton([root, hand]));
    // The hand swings a metre and a half out after the bounds were computed.
    mesh.computeBoundingBox();
    hand.position.set(1.5, 0, 0);
    mesh.updateMatrixWorld(true);
    const bounds = casterBounds(mesh, light, new Box3());
    const handInLight = new Vector3(1.5, 0, 0).applyMatrix4(light.shadow.camera.matrixWorldInverse);
    const reach = new Box3().setFromCenterAndSize(
      handInLight,
      new Vector3().setScalar(2 * KEY_SHADOW.boneReach - 1e-6),
    );
    expect(bounds.containsBox(reach)).toBe(true);
  });
});

describe("keyShadowFitter and configureKeyShadow", () => {
  it("fit the light's camera and map to the casters, with a normal offset of a texel", () => {
    const light = key();
    const scene = new Group();
    const caster = new Mesh(new BoxGeometry(0.6, 1.8, 0.4), new MeshBasicMaterial());
    caster.castShadow = true;
    caster.position.y = 0.9;
    scene.add(caster);
    scene.updateMatrixWorld(true);
    const frame = keyShadowFitter()(light, scene);
    const cam = light.shadow.camera;
    expect([cam.left, cam.right, cam.bottom, cam.top, cam.near, cam.far]).toEqual([
      frame.left,
      frame.right,
      frame.bottom,
      frame.top,
      frame.near,
      frame.far,
    ]);
    expect(light.shadow.mapSize.toArray()).toEqual([frame.mapWidth, frame.mapHeight]);
    expect(light.shadow.normalBias).toBeCloseTo(KEY_SHADOW.normalBias * frame.texel, 12);
    // The filter reads the light's radius as its tent's half-width.
    expect(light.shadow.radius).toBe(frame.radius);
    expect(light.shadow.bias).toBe(KEY_SHADOW.bias);
  });

  it("fall back to the stage's figure box when nothing casts", () => {
    const light = key();
    keyShadowFitter()(light, new Group());
    const cam = light.shadow.camera;
    // The box of 1.4 m each way about the origin, whose diagonal the window holds.
    expect(cam.right - cam.left).toBeGreaterThan(2 * KEY_SHADOW.defaultHalfExtent);
    expect(cam.top - cam.bottom).toBeGreaterThan(2 * KEY_SHADOW.defaultHalfExtent);
  });

  it("install the filter once: configureKeyShadow installs it, and installing twice changes nothing", () => {
    const light = key();
    configureKeyShadow(light);
    expect(shadowFilterInstalled()).toBe(true);
    const chunk = ShaderChunk.shadowmap_pars_fragment;
    installShadowFilter();
    expect(ShaderChunk.shadowmap_pars_fragment).toBe(chunk);
    // It replaced three's PCF reads for directional and spot lights, and left the
    // other filters (variance, basic, point lights' PCF) alone.
    expect(chunk).toContain("humanoid-kit: tent PCF");
    expect(chunk).not.toContain("vogelDiskSample( 0, 5, phi ) * radius");
    expect(chunk).toContain("SHADOWMAP_TYPE_VSM");
    expect(chunk).toContain("float getPointShadow( samplerCubeShadow");
  });

  it("frame applied by hand is the frame the light has", () => {
    const light = key();
    const frame = frameKeyShadow(figure());
    applyKeyShadowFrame(light, frame);
    expect(light.shadow.camera.left).toBe(frame.left);
    expect(light.shadow.mapSize.x).toBe(frame.mapWidth);
  });
});
