import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { labFromLinear, lchFromLab, linearFromLab } from "../src/surface/cielab.ts";
import {
  GUM_LAB,
  GUM_PIGMENT_LAB,
  GUM_SATURATION,
  GUM_TEXTURE_MEAN_LUMINANCE,
  gumAppearance,
  gumPigmentAmount,
} from "../src/surface/gumTone.ts";
import { luminance } from "../src/surface/skinTone.ts";
import { bodyDir, bodyManifest } from "./fixtures.ts";

const tone = (melanin: number) => ({ melanin, haemoglobin: 0.5, undertone: 0, override: null });

describe("the gums' colour", () => {
  it("is coral pink: lighter and less saturated than a red, warm in hue", () => {
    const [L, C, h] = lchFromLab(GUM_LAB);
    expect(L).toBeGreaterThan(58);
    expect(L).toBeLessThan(75);
    expect(C).toBeGreaterThan(18);
    expect(C).toBeLessThan(32);
    // Pink to coral: between a blue-red (below 10 degrees) and orange (60).
    expect(h).toBeGreaterThan(15);
    expect(h).toBeLessThan(40);
  });

  it("is pigmented with melanin more and more on deeper skin, never on the palest", () => {
    expect(gumPigmentAmount(tone(0))).toBe(0);
    expect(gumPigmentAmount(tone(0.2))).toBe(0);
    let last = 0;
    for (const m of [0.3, 0.45, 0.6, 0.75, 0.9, 1]) {
      const a = gumPigmentAmount(tone(m));
      expect(a).toBeGreaterThanOrEqual(last);
      last = a;
    }
    expect(gumPigmentAmount(tone(1))).toBeGreaterThan(0.6);
    expect(gumPigmentAmount(tone(1))).toBeLessThan(1);
  });

  it("is browner and darker where it is pigmented", () => {
    const [Lp, Cp, hp] = lchFromLab(GUM_PIGMENT_LAB);
    const [L, C, h] = lchFromLab(GUM_LAB);
    expect(Lp).toBeLessThan(L - 15);
    expect(hp).toBeGreaterThan(h);
    expect(Cp).toBeGreaterThan(5);
    expect(Cp).toBeLessThan(C);
  });

  it("is given to the shader as the colour that makes the texture's gum reach it", () => {
    const a = gumAppearance(tone(0.5));
    const base = linearFromLab(GUM_LAB);
    a.base.forEach((tint, k) => {
      expect(tint * GUM_TEXTURE_MEAN_LUMINANCE).toBeCloseTo(base[k] as number, 6);
    });
    expect(a.amount).toBe(gumPigmentAmount(tone(0.5)));
    expect(luminance(a.pigment)).toBeLessThan(luminance(a.base));
  });

  it("measures the shipped texture: the constant is the mean luminance of its gum texels", async () => {
    // The gum is the saturated red of the atlas: opaque texels whose red is mostly not green.
    const entry = bodyManifest.attachments.entries.find((e) => e.id === "teeth/base");
    const file = path.join(bodyDir, entry?.material.texture ?? "");
    const { data } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const lin = (v: number) =>
      v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
    let sum = 0;
    let n = 0;
    let between = 0;
    let dull = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, alpha] = [data[i], data[i + 1], data[i + 2], data[i + 3]] as number[];
      if ((alpha as number) <= 200) continue;
      const [lr, lg, lb] = [lin(r as number), lin(g as number), lin(b as number)];
      const saturation = (lr - lg) / Math.max(lr, 1e-3);
      if (saturation < GUM_SATURATION) {
        // The tooth side: no texel but a handful is anywhere near the gum's saturation.
        dull++;
        if (saturation >= GUM_SATURATION - 0.2) between++;
        continue;
      }
      sum += 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
      n++;
    }
    expect(n).toBeGreaterThan(50_000);
    expect(sum / n).toBeCloseTo(GUM_TEXTURE_MEAN_LUMINANCE, 3);
    // The threshold sits in the valley between two groups of texels (the band
    // from 0.2 under it up to it holds under 3% of the texels below it), so its
    // exact value matters little.
    expect(between / dull).toBeLessThan(0.03);
    expect(labFromLinear([0.2, 0.05, 0.05])[1]).toBeGreaterThan(0);
  });
});
