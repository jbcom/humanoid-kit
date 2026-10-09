/**
 * The colour an attachment's material is drawn with.
 *
 * MakeHuman's materials multiply a diffuse colour into the texture in its own
 * display-referred pipeline, which the pack carries as it is. The teeth's is a
 * flat 0.64 over a texture whose teeth are mid grey, so here, where both are
 * decoded to linear light, enamel came out as a grey of about 0.18 albedo:
 * darker than the skin around it, where real teeth are the lightest thing in
 * a face. Teeth are therefore given the colour that makes their texture reach
 * the albedo of enamel, whatever the material said.
 */
import { Color, DoubleSide, FrontSide } from "three";
import type { AttachmentMaterial } from "../format/assetFormat.ts";
import type { Lab } from "../surface/cielab.ts";
import { linearFromLab } from "../surface/cielab.ts";
import type { Rgb } from "../surface/skinTone.ts";
import { AttachmentStandardMaterial } from "./occlusion.ts";

/**
 * A natural tooth's CIELAB colour: ivory, lighter than any skin and a little
 * yellow (typical dental spectrophotometry of a mid-light tooth, VITA
 * Classical A1 to A2 range: L* 74 to 77, a* about 1, b* 12 to 17; the lighter,
 * less yellow end, since a screen shows a tooth beside warm skin and the full
 * A2 yellow read as stained at every tone).
 */
export const ENAMEL_LAB: Readonly<Lab> = [76, 0.5, 12];

/**
 * The mean linear colour of the teeth texture's tooth texels (the opaque,
 * near-grey ones; the red are gum), measured from `teeth_base_teeth.webp`. A
 * test re-measures the shipped texture and fails if this drifts.
 */
export const TEETH_TEXTURE_MEAN: Readonly<Rgb> = [0.29, 0.267, 0.263];

/** The colour to multiply into `kind`'s texture: the pack's own, except for teeth. */
export function attachmentColour(kind: string, color: Readonly<Rgb>): Rgb {
  if (kind !== "teeth") return [color[0], color[1], color[2]];
  const enamel = linearFromLab(ENAMEL_LAB);
  return [
    enamel[0] / TEETH_TEXTURE_MEAN[0],
    enamel[1] / TEETH_TEXTURE_MEAN[1],
    enamel[2] / TEETH_TEXTURE_MEAN[2],
  ];
}

/**
 * A standard material for an attachment the way the pack describes it (its
 * roughness, transparency and culling), coloured by `attachmentColour`. The
 * texture, if any, is set by the caller once it has loaded.
 */
export function createAttachmentMaterial(
  kind: string,
  m: AttachmentMaterial,
): AttachmentStandardMaterial {
  const [r, g, b] = attachmentColour(kind, m.color);
  return new AttachmentStandardMaterial({
    color: new Color(r, g, b),
    roughness: m.roughness,
    metalness: 0,
    transparent: m.transparent && !m.alphaToCoverage,
    alphaToCoverage: m.alphaToCoverage,
    side: m.backfaceCull ? FrontSide : DoubleSide,
  });
}
