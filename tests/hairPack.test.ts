import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addHairStyle,
  type HairManifest,
  type HairStyleEntry,
  parseHumanoidAssets,
} from "../src/format/assetFormat.ts";
import { HAIR_STRAND_MEAN } from "../src/surface/hairTone.ts";
import { bodyManifest, bodyPackData } from "./fixtures.ts";
import {
  hairDir,
  hairManifest,
  hairStyleBin,
  loadHairFixtureAssets,
  scalpStyles,
} from "./hairFixtures.ts";

const sha = (file: string) =>
  createHash("sha256")
    .update(fs.readFileSync(path.join(hairDir, file)))
    .digest("hex");

/** MakeHuman's own scalp hairs that are CC0 and bind to the base mesh, best first. */
const STYLES = [
  "short02",
  "bob02",
  "long01",
  "afro01",
  "short04",
  "short03",
  "ponytail01",
  "short01",
  "bob01",
  "braid01",
];

const KB = 1024;

describe("the hair pack's manifest", () => {
  it("is a hair pack for exactly the body pack it sits beside", () => {
    expect(hairManifest.format).toBe(1);
    expect(hairManifest.kind).toBe("hair");
    expect(hairManifest.topology).toBe(bodyManifest.topology);
    expect(hairManifest.bodySha256).toBe(bodyManifest.body.sha256);
    expect(hairManifest.source.license).toBe("CC0-1.0");
  });

  it("lists the shortlisted styles, each with a label and tags", () => {
    expect(scalpStyles.map((s) => s.id)).toEqual(STYLES);
    for (const s of scalpStyles) {
      expect(s.kind, s.id).toBe("scalp");
      expect(s.label.length, s.id).toBeGreaterThan(0);
      expect(s.tags.length, s.id).toBeGreaterThan(0);
    }
  });

  it("records each style's file hash, which is the hash of the file as shipped", () => {
    for (const s of scalpStyles) {
      expect(s.sha256, s.id).toBe(sha(s.file));
      expect(fs.existsSync(path.join(hairDir, s.material.texture as string)), s.id).toBe(true);
    }
  });
});

describe("a style's binding", () => {
  const assets = loadHairFixtureAssets();
  const n = bodyManifest.vertexCount;

  it("binds every vertex to base-mesh vertices that exist, with weights that sum to one", () => {
    for (const s of scalpStyles) {
      const a = assets.hair?.bound.get(s.id);
      expect(a, s.id).toBeDefined();
      if (!a) continue;
      expect(a.refVerts.length).toBe(s.vertexCount * 3);
      expect(Math.max(...a.refVerts), s.id).toBeLessThan(n);
      let worst = 0;
      for (let v = 0; v < s.vertexCount; v++) {
        const w =
          (a.weights[v * 3] as number) +
          (a.weights[v * 3 + 1] as number) +
          (a.weights[v * 3 + 2] as number);
        worst = Math.max(worst, Math.abs(w - 1));
      }
      expect(worst, s.id).toBeLessThan(1e-4);
    }
  });

  it("hides no body vertex: MakeHuman's hair has no delete_verts, so the scalp stays", () => {
    for (const s of scalpStyles) {
      expect(assets.hair?.bound.get(s.id)?.deleteVerts.length, s.id).toBe(0);
    }
  });

  it("bakes one occlusion value per control vertex: open outside the hair, shut deep in it", () => {
    for (const s of scalpStyles) {
      const o = assets.hair?.bound.get(s.id)?.occlusion as Uint8Array;
      expect(o.length, s.id).toBe(s.vertexCount);
      const mean = o.reduce((t, x) => t + x, 0) / o.length / 255;
      // A bun of curls buries more of itself than a crop does, but none is all one or the other.
      expect(mean, s.id).toBeGreaterThan(0.3);
      expect(mean, s.id).toBeLessThan(1);
      expect(Math.max(...o), s.id).toBeGreaterThan(240);
      expect(Math.min(...o), s.id).toBeLessThan(130);
    }
  });

  it("uses the helper-hair vertices the body pack already carries (bob01, braid01, long01, ponytail01)", () => {
    // Range 18722-19149 is the base mesh's `helper-hair` group.
    for (const id of ["bob01", "braid01", "long01", "ponytail01"]) {
      const a = assets.hair?.bound.get(id);
      expect(a ? Math.max(...a.refVerts) : 0, id).toBeGreaterThanOrEqual(18722);
    }
  });
});

describe("a style's strand map", () => {
  /** What each map measures, decoded once: size, grey-ness, mean linear luminance, share of clear texels. */
  const measured = new Map<
    string,
    { size: number; maxChannelGap: number; mean: number; clearShare: number }
  >();
  beforeAll(async () => {
    for (const s of scalpStyles) {
      const { data, info } = await sharp(path.join(hairDir, s.material.texture as string))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let sum = 0;
      let weight = 0;
      let gap = 0;
      let clear = 0;
      for (let i = 0; i < data.length; i += 4) {
        gap = Math.max(gap, Math.abs((data[i] as number) - (data[i + 1] as number)));
        const c = (data[i] as number) / 255;
        const a = (data[i + 3] as number) / 255;
        sum += (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * a;
        weight += a;
        if (a < 5 / 255) clear++;
      }
      measured.set(s.id, {
        size: Math.max(info.width, info.height),
        maxChannelGap: gap,
        mean: sum / weight,
        clearShare: clear / (data.length / 4),
      });
    }
  }, 120_000);

  it("is grey and sized for the web", () => {
    for (const s of scalpStyles) {
      const m = measured.get(s.id);
      expect(m?.size, s.id).toBeLessThanOrEqual(1024);
      // Lossy WebP leaves a rounding of a few levels between channels.
      expect(m?.maxChannelGap, s.id).toBeLessThanOrEqual(8);
    }
  });

  it("averages HAIR_STRAND_MEAN in linear light, so the recipe's colour is the albedo", () => {
    for (const s of scalpStyles) {
      const mean = measured.get(s.id)?.mean as number;
      expect(mean, s.id).toBeGreaterThan(HAIR_STRAND_MEAN * 0.9);
      expect(mean, s.id).toBeLessThan(HAIR_STRAND_MEAN * 1.1);
    }
  });

  it("keeps the cards' cut-out: every style but the solid braid has clear texels", () => {
    for (const s of scalpStyles) {
      const share = measured.get(s.id)?.clearShare as number;
      if (s.id === "braid01") expect(share, s.id).toBeLessThan(0.01);
      else expect(share, s.id).toBeGreaterThan(0.15);
    }
  });

  it("reports the strand direction and how consistent it is", () => {
    for (const s of scalpStyles) {
      expect(s.strand.angle, s.id).toBeGreaterThanOrEqual(0);
      expect(s.strand.angle, s.id).toBeLessThan(Math.PI);
      expect(s.strand.coherence, s.id).toBeGreaterThanOrEqual(0);
      expect(s.strand.coherence, s.id).toBeLessThanOrEqual(1);
    }
  });
});

describe("the pack's size", () => {
  const sizeOf = (s: HairStyleEntry) =>
    fs.statSync(path.join(hairDir, s.file)).size +
    fs.statSync(path.join(hairDir, s.material.texture as string)).size;

  it("keeps each style under 800 kilobytes, since a figure loads one", () => {
    for (const s of scalpStyles) expect(sizeOf(s), s.id).toBeLessThan(800 * KB);
  });

  it("keeps the whole pack under four megabytes", () => {
    const total = scalpStyles.reduce((t, s) => t + sizeOf(s), 0);
    expect(total).toBeLessThan(4 * 1024 * KB);
  });
});

describe("provenance", () => {
  const text = fs.readFileSync(path.join(hairDir, "PROVENANCE.md"), "utf8");

  it("names the source pack and its CC0 evidence for every source file", () => {
    expect(text).toMatch(/makehuman_system_assets_cc0\.zip/);
    expect(text).toMatch(/explicitly released as CC0/);
    // Per style: the .mhclo, the .obj and the .mhmat each proved their own header.
    expect(text).toMatch(new RegExp(`${hairManifest.styles.length * 3} file\\(s\\) — file header`));
  });

  it("lists the hash of every shipped file", () => {
    for (const s of hairManifest.styles) {
      expect(text, s.file).toContain(sha(s.file));
      expect(text, s.material.texture as string).toContain(sha(s.material.texture as string));
    }
  });
});

describe("loading the pack", () => {
  it("parses beside the body pack, and refuses a body pack it was not built for", () => {
    const body = bodyPackData(["core"]);
    const parsed = parseHumanoidAssets(body, undefined, undefined, { manifest: hairManifest });
    expect(parsed.hair?.styles.size).toBe(hairManifest.styles.length);
    expect(parsed.hair?.bound.size).toBe(0);
    const other = {
      ...body,
      manifest: { ...body.manifest, body: { ...body.manifest.body, sha256: "0".repeat(64) } },
    };
    expect(() =>
      parseHumanoidAssets(other, undefined, undefined, { manifest: hairManifest }),
    ).toThrow(/different body pack/);
  });

  it("refuses a style of a kind it does not know, and accepts brows and lashes beside scalp hair", () => {
    const body = bodyPackData(["core"]);
    const withKind = (kind: string): HairManifest => ({
      ...hairManifest,
      styles: hairManifest.styles.map((s, i) => (i === 0 ? { ...s, kind: kind as never } : s)),
    });
    expect(() =>
      parseHumanoidAssets(body, undefined, undefined, { manifest: withKind("beard") }),
    ).toThrow(/unknown hair kind/);
    for (const kind of ["brows", "lashes"]) {
      const parsed = parseHumanoidAssets(body, undefined, undefined, { manifest: withKind(kind) });
      expect(parsed.hair?.styles.get(STYLES[0] as string)?.kind).toBe(kind);
    }
  });

  it("refuses a style whose bytes do not match its manifest", () => {
    const body = bodyPackData(["core"]);
    const parsed = parseHumanoidAssets(body, undefined, undefined, { manifest: hairManifest });
    const short = hairStyleBin("short02").slice(0, 128);
    expect(() => addHairStyle(parsed, "short02", short)).toThrow(/exceeds|range/);
    expect(parsed.hair?.bound.size).toBe(0);
    expect(() => addHairStyle(parsed, "no-such-style", short)).toThrow(/no hair style/);
  });
});
