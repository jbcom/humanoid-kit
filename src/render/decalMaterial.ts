/**
 * The material for eyebrows and eyelashes: MakeHuman's decals are flat quads
 * lying on the skin, cut out by a white alpha mask (the pack's texture), so the
 * material is a plain standard one, tinted by the hair colour
 * (`browColour`, `lashColour`) and cut by the mask's alpha.
 *
 * Why not `HairMaterial`: that one is made for cards standing out of a scalp:
 * its growth, hairline fade, fin and strand highlight attributes mean nothing on
 * a decal and a missing one reads as "dithered away". A decal has one job, to
 * show a mask in a colour over the skin. It draws over the skin it lies on
 * (a polygon offset toward the camera) however little it is lifted, and takes
 * its edges the way hair does: alpha-to-coverage on a multisampled target, a
 * plain alpha test otherwise.
 *
 * `setOpacity` thins it for a young face: the opacity multiplies the mask's
 * alpha before the cut, so the partial strokes go first and a toddler's
 * brow is a few clear strokes.
 */
import { DoubleSide, LinearSRGBColorSpace, MeshStandardMaterial } from "three";
import type { Rgb } from "../surface/skinTone.ts";

/** Texels below this alpha (after the opacity) are cut out. */
export const DECAL_ALPHA_CUTOFF = 0.35;

export class DecalMaterial extends MeshStandardMaterial {
  constructor() {
    super({
      side: DoubleSide,
      roughness: 0.6,
      metalness: 0,
      alphaTest: DECAL_ALPHA_CUTOFF,
      alphaToCoverage: true,
      transparent: false,
      // Over the skin it lies on, whatever the depth precision.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  /** The hair colour, linear. */
  setColour(rgb: Readonly<Rgb>): void {
    this.color.setRGB(rgb[0], rgb[1], rgb[2], LinearSRGBColorSpace);
  }

  /** How much of the mask is kept, 0 to 1 (`decalOpacity`). */
  setOpacity(opacity: number): void {
    this.opacity = opacity;
  }

  /** Alpha-to-coverage on a multisampled target, a plain alpha test otherwise. */
  setMultisampled(multisampled: boolean): void {
    if (this.alphaToCoverage === multisampled) return;
    this.alphaToCoverage = multisampled;
    this.needsUpdate = true;
  }
}
