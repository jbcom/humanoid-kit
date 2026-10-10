/**
 * The studio key light's shadow, tuned for skin. A shadow map's edge is as sharp as
 * its texel, and a skin's self-shadow (a thigh under a belly, an arm across a
 * chest) with a hard, stepped edge reads as dirt: a real shadow on skin has a
 * penumbra, because the light is a softbox, not a point. The map is fitted to
 * the figure (a 2.8 m box, not the light's default 10 m, so a texel is about a
 * millimetre) and blurred (a variance shadow map, `STUDIO_SHADOWS`, which a
 * gaussian blur softens without the banding a few-tap filter gives at a wide
 * radius) to a penumbra of about a centimetre, which at a body framing (about
 * 4 mm a pixel) is a few pixels.
 *
 * `tests/browser/skinShadow.test.ts` measures the penumbra on the skin material.
 */
import type { DirectionalLight } from "three";

/** The canvas's `shadows` prop the stage is validated with. */
export const STUDIO_SHADOWS = "variance" as const;

export const KEY_SHADOW = {
  /** Texels a side. */
  mapSize: 2048,
  /** Half the width of the shadow camera's box, metres: a figure (a swimmer is 2.3 m) and its reach. */
  extent: 1.4,
  near: 1,
  far: 9,
  /** The blur's radius in texels, and how many taps it takes. */
  radius: 14,
  blurSamples: 31,
  bias: -0.0002,
  normalBias: 0.01,
} as const;

/** Applies `KEY_SHADOW` to the key light. */
export function configureKeyShadow(light: DirectionalLight): void {
  const s = light.shadow;
  s.mapSize.set(KEY_SHADOW.mapSize, KEY_SHADOW.mapSize);
  const cam = s.camera;
  cam.left = -KEY_SHADOW.extent;
  cam.right = KEY_SHADOW.extent;
  cam.top = KEY_SHADOW.extent;
  cam.bottom = -KEY_SHADOW.extent;
  cam.near = KEY_SHADOW.near;
  cam.far = KEY_SHADOW.far;
  cam.updateProjectionMatrix();
  s.radius = KEY_SHADOW.radius;
  s.blurSamples = KEY_SHADOW.blurSamples;
  s.bias = KEY_SHADOW.bias;
  s.normalBias = KEY_SHADOW.normalBias;
}
