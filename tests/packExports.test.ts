import { createHash } from "node:crypto";
import fs from "node:fs";
import { adultAnatomyPack } from "humanoid-kit-adult-anatomy";
import { animationsPack } from "humanoid-kit-animations";
import { bodyPack } from "humanoid-kit-body";
import { clothingPack } from "humanoid-kit-clothing";
import { eyesPack } from "humanoid-kit-eyes";
import { hairPack } from "humanoid-kit-hair";
import { describe, expect, it } from "vitest";

interface PackUrls {
  manifest: string;
  files: Readonly<Record<string, string>>;
}

describe("the shipped data-pack exports", () => {
  it("resolves every exported asset URL to a real file for consumer bundlers", () => {
    const packs: readonly PackUrls[] = [
      bodyPack,
      adultAnatomyPack,
      hairPack,
      eyesPack,
      animationsPack,
      clothingPack,
    ];
    for (const pack of packs)
      for (const href of [pack.manifest, ...Object.values(pack.files)]) {
        const url = new URL(href);
        expect(url.protocol, href).toBe("file:");
        expect(fs.existsSync(url), href).toBe(true);
        expect(fs.statSync(url).isFile(), href).toBe(true);
      }
  });

  it("exports exactly the declared hair assets and their attribution and source receipts", () => {
    const manifest = JSON.parse(fs.readFileSync(new URL(hairPack.manifest), "utf8")) as {
      styles: { file: string; material: { texture: string } }[];
    };
    const declared = manifest.styles.flatMap((style) => [style.file, style.material.texture]);
    expect(Object.keys(hairPack.files).sort()).toEqual(
      [...declared, "ASSET-ATTRIBUTION.md", "ASSET-SOURCES.md"].sort(),
    );
  });

  it("ships the age-surface map in both the body manifest and its exported URLs", () => {
    const manifest = JSON.parse(fs.readFileSync(new URL(bodyPack.manifest), "utf8")) as {
      ageSurface?: { file: string; sha256: string; size: number };
    };
    const map = manifest.ageSurface;
    if (!map) throw new Error("the shipped body pack omits its age-surface map");
    expect(map.file).toBe("age-surface.webp");
    expect(map.size).toBe(2048);
    const href = bodyPack.files["age-surface.webp"];
    expect(href, "the body index must export the shipped age-surface map").toBeDefined();
    const bytes = fs.readFileSync(new URL(href));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(map.sha256);
  });
});
