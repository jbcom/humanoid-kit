/**
 * The studio key light's shadow, tuned for skin (`docs/ARCHITECTURE.md`, "The key
 * light's shadow"). A shadow map's edge is as sharp as its texel, and a skin's
 * self-shadow (a thigh beside the groin, the back of a knee, an arm across a chest)
 * with a hard, stepped edge reads as dirt: a real shadow on skin has a penumbra,
 * because the light is a softbox, not a point.
 *
 * The penumbra is set in metres (`KEY_SHADOW.penumbra`, about a centimetre and a
 * half) and drawn by a tent over three's percentage-closer map (`shadowFilter.ts`),
 * `radius` texels to each side. The texel follows from the two (`keyShadowTexel`:
 * the penumbra over 1.1 radius), and the map is fitted to whatever casts a shadow
 * (`keyShadowFitter`, every frame): its window snapped to that texel's grid, so a
 * figure that moves does not make its shadow swim, and its size in texels what the
 * window needs, so one figure costs a map of several hundred texels a side and a
 * crowd one up to `maxMapSize`, past which the texel (and the penumbra with it)
 * grows instead. A wider tent costs more reads (radius²) and a finer map, and leaves
 * a smaller staircase (`shadowFilter.ts`): 12 is the stage's, 4 a phone's.
 *
 * Depth is compared against the casters' back faces (three's PCF default), which keeps
 * a lit surface off its own depth, and a normal offset of one texel covers the
 * terminator; there is no flat depth bias.
 *
 * `tests/browser/skinShadow.test.ts` measures the penumbra, and
 * `tests/browser/shadowEdge.test.ts` the staircase and the acne.
 */
import {
  Box3,
  type DirectionalLight,
  type Mesh,
  type Object3D,
  PCFShadowMap,
  type Skeleton,
  type SkinnedMesh,
  Vector3,
} from "three";
import { installShadowFilter, MAX_TENT_RADIUS, tentEdgeWidth } from "./shadowFilter.ts";

/** The canvas's `shadows` prop the stage is validated with (react-three-fiber's name for `PCFShadowMap`). */
export const STUDIO_SHADOWS = "percentage" as const;
/** The same, as three's constant, for a renderer set up without react-three-fiber. */
export const STUDIO_SHADOW_MAP_TYPE = PCFShadowMap;

/** Where the stage's key light stands, high and to the front-left, aimed at the origin. */
export const KEY_POSITION = [1.8, 3.2, 2.6] as const;

export const KEY_SHADOW = {
  /** The penumbra, 10 % to 90 %, on skin facing the light, metres. */
  penumbra: 0.016,
  /**
   * The tent's half-width, texels: radius² reads a shaded pixel. 12 is the narrowest
   * whose staircase stays under 2 % of the penumbra (`shadowEdge.test.ts`).
   */
  radius: 12,
  /** The normal offset, in texels: a sample is taken this far off the surface. */
  normalBias: 1,
  /** No depth offset: the back faces and the normal offset keep a lit surface off its own depth. */
  bias: 0,
  /** The largest map, texels a side; past it the texel grows (by eighths of an octave). */
  maxMapSize: 2048,
  /** A map's sides are multiples of this many texels, so it is not reallocated as its casters drift. */
  mapStep: 128,
  /** Space kept around the casters, metres. */
  margin: 0.05,
  /** How far a skinned mesh's skin may lie from its bones, metres: bounds computed at one pose still cover the next. */
  boneReach: 0.25,
  /** Depth kept in front of and behind the casters, metres. */
  depthMargin: 0.5,
  /** With nothing casting, the window is the stage's figure box: this many metres each way from the origin. */
  defaultHalfExtent: 1.4,
} as const;

/** How the key's shadow is drawn: the tent's half-width, and the largest map. */
export interface KeyShadowOptions {
  /** The tent's half-width in texels, 1 to 16 (radius² reads). Default `KEY_SHADOW.radius`. */
  radius?: number;
  /** The largest map, texels a side. Default `KEY_SHADOW.maxMapSize`. */
  maxMapSize?: number;
}

/** The texel, metres, that draws the key's penumbra through a tent of `radius` texels. */
export function keyShadowTexel(radius: number = KEY_SHADOW.radius): number {
  return KEY_SHADOW.penumbra / tentEdgeWidth(radius);
}

/** The key's shadow camera window and map, in the light's view space (metres) and texels. */
export interface KeyShadowFrame {
  left: number;
  right: number;
  bottom: number;
  top: number;
  near: number;
  far: number;
  mapWidth: number;
  mapHeight: number;
  /** Metres a texel, on both axes. */
  texel: number;
  /** The tent's half-width, texels. */
  radius: number;
}

/**
 * The frame that covers `bounds` (the casters, in the light's view space: x right,
 * y up, the light looking down -z) at the texel `options.radius` needs, or a coarser
 * one when the map would pass `options.maxMapSize`. The window's edges lie on the
 * texel's grid. A `previous` frame's map size is kept while it still covers the
 * window and is not more than a step too big, so a figure that moves does not
 * reallocate the map.
 */
export function frameKeyShadow(
  bounds: Box3,
  previous: KeyShadowFrame | null = null,
  options: KeyShadowOptions = {},
): KeyShadowFrame {
  const { margin, mapStep, depthMargin } = KEY_SHADOW;
  const radius = Math.min(
    MAX_TENT_RADIUS,
    Math.max(1, Math.round(options.radius ?? KEY_SHADOW.radius)),
  );
  const maxMapSize = options.maxMapSize ?? KEY_SHADOW.maxMapSize;
  const width = bounds.max.x - bounds.min.x + 2 * margin;
  const height = bounds.max.y - bounds.min.y + 2 * margin;
  const cap = Math.max(mapStep, Math.floor(maxMapSize / mapStep) * mapStep);
  // One texel more than the span on each axis: snapping the window out to the grid adds up to one.
  const needed = Math.max(width, height) / (cap - 1);
  const ideal = keyShadowTexel(radius);
  const texel =
    needed <= ideal ? ideal : ideal * 2 ** (Math.ceil(8 * Math.log2(needed / ideal)) / 8);
  const left = Math.floor((bounds.min.x - margin) / texel) * texel;
  const bottom = Math.floor((bounds.min.y - margin) / texel) * texel;
  const across = Math.ceil((bounds.max.x + margin - left) / texel);
  const up = Math.ceil((bounds.max.y + margin - bottom) / texel);
  const same = previous !== null && previous.texel === texel;
  const size = (texels: number, before: number | undefined) =>
    same && before !== undefined && before >= texels && before - texels < 2 * mapStep
      ? before
      : Math.min(cap, Math.ceil(texels / mapStep) * mapStep);
  const mapWidth = size(across, previous?.mapWidth);
  const mapHeight = size(up, previous?.mapHeight);
  return {
    left,
    right: left + mapWidth * texel,
    bottom,
    top: bottom + mapHeight * texel,
    near: -bounds.max.z - depthMargin,
    far: -bounds.min.z + depthMargin,
    mapWidth,
    mapHeight,
    texel,
    radius,
  };
}

const scratch = {
  point: new Vector3(),
  box: new Box3(),
  reach: new Vector3(),
  skeletons: new Set<Skeleton>(),
};

/** Points the light's shadow camera along the light, as three does before it draws the map. */
function aimShadowCamera(light: DirectionalLight): void {
  light.updateWorldMatrix(true, false);
  light.target.updateWorldMatrix(true, false);
  const camera = light.shadow.camera;
  camera.position.setFromMatrixPosition(light.matrixWorld);
  camera.lookAt(scratch.point.setFromMatrixPosition(light.target.matrixWorld));
  camera.updateMatrixWorld(true);
}

/** Sets the light's shadow camera, map and filter to `frame`. */
export function applyKeyShadowFrame(light: DirectionalLight, frame: KeyShadowFrame): void {
  const shadow = light.shadow;
  const camera = shadow.camera;
  camera.left = frame.left;
  camera.right = frame.right;
  camera.bottom = frame.bottom;
  camera.top = frame.top;
  camera.near = frame.near;
  camera.far = frame.far;
  camera.updateProjectionMatrix();
  // three reallocates the map when its size changes.
  shadow.mapSize.set(frame.mapWidth, frame.mapHeight);
  // The filter (`shadowFilter.ts`) reads `radius` as the tent's half-width.
  shadow.radius = frame.radius;
  shadow.bias = KEY_SHADOW.bias;
  shadow.normalBias = KEY_SHADOW.normalBias * frame.texel;
}

/**
 * The bounds, in the light's view space, of everything visible that casts a shadow
 * under `root`: each mesh's box (a skinned or instanced mesh's own, posed), and for a
 * skinned mesh every bone of its skeleton with `KEY_SHADOW.boneReach` around it, so
 * a limb an animation swings outside the box its bounds were last computed at is
 * still covered. Empty when nothing casts.
 */
export function casterBounds(root: Object3D, light: DirectionalLight, out: Box3): Box3 {
  // The fitter runs before the frame is drawn, so before three brings world matrices up
  // to date: on a figure's first frame, or after it jumps, they would still be old.
  root.updateMatrixWorld();
  aimShadowCamera(light);
  const view = light.shadow.camera.matrixWorldInverse;
  out.makeEmpty();
  scratch.skeletons.clear();
  scratch.reach.setScalar(2 * KEY_SHADOW.boneReach);
  root.traverseVisible((o) => {
    const mesh = o as Mesh & { boundingBox?: Box3 | null; computeBoundingBox?: () => void };
    if (!mesh.isMesh || !mesh.castShadow) return;
    let local: Box3 | null;
    if (mesh.boundingBox !== undefined) {
      if (mesh.boundingBox === null) mesh.computeBoundingBox?.();
      local = mesh.boundingBox;
    } else {
      if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
      local = mesh.geometry.boundingBox;
    }
    if (local && !local.isEmpty())
      out.union(scratch.box.copy(local).applyMatrix4(mesh.matrixWorld).applyMatrix4(view));
    const skeleton = (mesh as unknown as SkinnedMesh).isSkinnedMesh
      ? (mesh as unknown as SkinnedMesh).skeleton
      : null;
    if (!skeleton || scratch.skeletons.has(skeleton)) return;
    scratch.skeletons.add(skeleton);
    for (const bone of skeleton.bones) {
      scratch.point.setFromMatrixPosition(bone.matrixWorld).applyMatrix4(view);
      out.union(scratch.box.setFromCenterAndSize(scratch.point, scratch.reach));
    }
  });
  return out;
}

/** The stage's figure box about the origin, in the light's view space. */
function defaultBounds(light: DirectionalLight, out: Box3): Box3 {
  aimShadowCamera(light);
  const e = KEY_SHADOW.defaultHalfExtent;
  out.min.set(-e, -e, -e);
  out.max.set(e, e, e);
  return out.applyMatrix4(light.shadow.camera.matrixWorldInverse);
}

/**
 * Sets up the key light's shadow for skin: installs the tent filter (`shadowFilter.ts`;
 * do it before the first frame compiles a material) and frames the map on the stage's
 * figure box about the origin. `keyShadowFitter` then fits it to the casters each frame.
 */
export function configureKeyShadow(light: DirectionalLight, options: KeyShadowOptions = {}): void {
  installShadowFilter();
  applyKeyShadowFrame(light, frameKeyShadow(defaultBounds(light, new Box3()), null, options));
}

/**
 * A per-frame fitter for one key light: call it with the light and the scene before
 * each render. It fits the map to what casts (`casterBounds`), or to the stage's
 * figure box when nothing does, keeping the map's size from frame to frame while it
 * fits (`frameKeyShadow`).
 */
export function keyShadowFitter(
  options: KeyShadowOptions = {},
): (light: DirectionalLight, scene: Object3D) => KeyShadowFrame {
  const bounds = new Box3();
  let previous: KeyShadowFrame | null = null;
  return (light, scene) => {
    casterBounds(scene, light, bounds);
    if (bounds.isEmpty()) defaultBounds(light, bounds);
    previous = frameKeyShadow(bounds, previous, options);
    applyKeyShadowFrame(light, previous);
    return previous;
  };
}
