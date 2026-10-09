import path from "node:path";
import sharp from "sharp";
import { DoubleSide, FrontSide } from "three";
import { describe, expect, it } from "vitest";
import type { AttachmentMaterial } from "../src/format/assetFormat.ts";
import {
  attachmentColour,
  createAttachmentMaterial,
  ENAMEL_LAB,
  TEETH_TEXTURE_MEAN,
} from "../src/render/attachmentLook.ts";
import { labFromLinear, linearFromLab } from "../src/surface/cielab.ts";
import { luminance, type Rgb } from "../src/surface/skinTone.ts";
import { bodyDir, bodyManifest } from "./fixtures.ts";

const mhmat: Rgb = [0.64, 0.64, 0.64];
const product = (a: Readonly<Rgb>, b: Readonly<Rgb>): Rgb => [
  a[0] * b[0],
  a[1] * b[1],
  a[2] * b[2],
];

describe("the material an attachment is drawn with", () => {
  const described = (color: Rgb): AttachmentMaterial => ({
    color,
    roughness: 0.4,
    texture: null,
    transparent: false,
    alphaToCoverage: true,
    backfaceCull: true,
  });

  it("is the pack's, coloured so teeth reach enamel", () => {
    const teeth = createAttachmentMaterial("teeth", described(mhmat));
    const lit = product(teeth.color.toArray() as Rgb, TEETH_TEXTURE_MEAN);
    const enamel = linearFromLab(ENAMEL_LAB);
    lit.forEach((c, k) => {
      expect(c).toBeCloseTo(enamel[k] as number, 6);
    });
    expect(teeth.roughness).toBe(0.4);
    expect(teeth.side).toBe(FrontSide);
    expect(teeth.alphaToCoverage).toBe(true);
    const tongue = createAttachmentMaterial("tongue", described([0.9, 0.8, 0.7]));
    expect(tongue.color.toArray()).toEqual([0.9, 0.8, 0.7]);
    expect(
      createAttachmentMaterial("hair", { ...described([1, 1, 1]), backfaceCull: false }).side,
    ).toBe(DoubleSide);
  });
});

describe("the colour an attachment is drawn with", () => {
  it("makes the teeth's texture reach the albedo of enamel, whatever the mhmat said", () => {
    const enamel = linearFromLab(ENAMEL_LAB);
    for (const given of [mhmat, [1, 1, 1] as Rgb, [0.2, 0.3, 0.4] as Rgb]) {
      const lit = product(attachmentColour("teeth", given), TEETH_TEXTURE_MEAN);
      lit.forEach((c, k) => {
        expect(c).toBeCloseTo(enamel[k] as number, 6);
      });
    }
  });

  it("leaves every other kind as the pack describes it", () => {
    for (const kind of ["tongue", "eyes", "hair", "clothes"])
      expect(attachmentColour(kind, [0.3, 0.5, 0.7])).toEqual([0.3, 0.5, 0.7]);
  });

  it("puts enamel at a plausible albedo: ivory, lighter than mid grey and not white", () => {
    const [L, a, b] = ENAMEL_LAB;
    expect(L).toBeGreaterThan(65);
    expect(L).toBeLessThan(85);
    // Warm and a little yellow, never blue or green.
    expect(b).toBeGreaterThan(a);
    expect(b).toBeGreaterThan(8);
    expect(luminance(linearFromLab(ENAMEL_LAB))).toBeGreaterThan(0.35);
    expect(luminance(linearFromLab(ENAMEL_LAB))).toBeLessThan(0.6);
  });

  it("measures the shipped teeth texture: the constant is the mean of its tooth texels", async () => {
    // Texels that are opaque and near grey are enamel; the red ones are gum.
    const file = path.join(
      bodyDir,
      bodyManifest.attachments.entries.find((e) => e.id === "teeth/base")?.material.texture ?? "",
    );
    const { data } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const linear = (v: number) =>
      v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
    const sum = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, bl, alpha] = [data[i], data[i + 1], data[i + 2], data[i + 3]] as number[];
      if (
        (alpha as number) <= 200 ||
        Math.abs((r as number) - (g as number)) >= 25 ||
        Math.abs((r as number) - (bl as number)) >= 25
      )
        continue;
      n++;
      sum[0] = (sum[0] as number) + linear(r as number);
      sum[1] = (sum[1] as number) + linear(g as number);
      sum[2] = (sum[2] as number) + linear(bl as number);
    }
    expect(n).toBeGreaterThan(100_000);
    sum.forEach((s, k) => {
      expect(s / n).toBeCloseTo(TEETH_TEXTURE_MEAN[k] as number, 2);
    });
    expect(labFromLinear(TEETH_TEXTURE_MEAN)[0]).toBeLessThan(ENAMEL_LAB[0]);
  });
});
