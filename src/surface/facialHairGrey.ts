/** Caller-authored greying fields on retained facial-attachment UVs; no renderer or asset intake. */
import { facialHairColour } from "../recipe/facialHairColour.ts";
import type { Recipe } from "../recipe/recipe.ts";
import { hairTint } from "./hairTone.ts";
import type { Rgb } from "./skinTone.ts";

export class FacialHairGreyError extends Error {
  override name = "FacialHairGreyError";
}

/** Single-channel linear weights, rows top first; the checksum pins the source style's UVs. */
export interface FacialHairGreyMask {
  sourceSha256: string;
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** Immutable decoded caller masks by the keys Recipe.facialHairGrey names. */
export type FacialHairGreyMasks = Readonly<Record<string, FacialHairGreyMask>>;

/** An owned bake or validated live field, with the unpigmented tint frozen for the appearance. */
export interface ResolvedFacialHairGrey extends FacialHairGreyMask {
  amount: number;
  tint: Rgb;
}

/** Validate before allocating/copying bytes; dimensions are limited by safe addressing and storage. */
export function assertFacialHairGreyMask(mask: unknown): asserts mask is FacialHairGreyMask {
  if (typeof mask !== "object" || mask === null)
    throw new FacialHairGreyError("mask must be decoded single-channel bytes");
  const { sourceSha256, width, height, data } = mask as FacialHairGreyMask;
  if (typeof sourceSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(sourceSha256))
    throw new FacialHairGreyError("mask sourceSha256 must pin a packed style checksum");
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isSafeInteger(width * height) ||
    !(data instanceof Uint8Array || data instanceof Uint8ClampedArray) ||
    data.length !== width * height
  )
    throw new FacialHairGreyError(
      "mask dimensions must be positive safe integers matching its byte length",
    );
}

/** Resolve explicitly requested masks. A missing/invalid request never becomes an unmasked fallback. */
export function resolveFacialHairGrey(
  recipe: Recipe,
  id: string,
  sourceSha256: string,
  masks?: FacialHairGreyMasks,
): ResolvedFacialHairGrey | null {
  const request = recipe.facialHairGrey?.[id];
  if (request === undefined) return null;
  try {
    if (
      !recipe.facialHair?.includes(id) ||
      !request ||
      typeof request.mask !== "string" ||
      request.mask === "" ||
      !Number.isFinite(request.amount) ||
      request.amount < 0 ||
      request.amount > 1
    )
      throw new FacialHairGreyError("invalid selected-style mask request");
    const mask = masks && Object.hasOwn(masks, request.mask) ? masks[request.mask] : undefined;
    if (!mask) throw new FacialHairGreyError("decoded mask is missing");
    assertFacialHairGreyMask(mask);
    if (mask.sourceSha256 !== sourceSha256)
      throw new FacialHairGreyError("mask checksum does not match the selected packed style");
    if (request.amount === 0 || !mask.data.some((value) => value !== 0)) return null;
    const colour = facialHairColour(recipe, id);
    return {
      ...mask,
      amount: request.amount,
      tint: hairTint({ ...colour, grey: 1, override: null }),
    };
  } catch (error) {
    throw new FacialHairGreyError(
      `facialHairGrey ${id} mask ${request?.mask}: ${(error as Error).message}`,
    );
  }
}

/** The linear pigment blend used by both renderers, independent of source RGB and alpha. */
export function facialHairGreyTint(base: Rgb, target: Rgb, amount: number, sample: number): Rgb {
  const q = amount * sample;
  return base.map((value, k) => (1 - q) * value + q * (target[k] as number)) as Rgb;
}
