import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { HAIR_FIELD_KEYS } from "../src/format/assetFormat.ts";
import { bodyManifest } from "./fixtures.ts";
import { hairDir, hairManifest, loadHairFixtureAssets } from "./hairFixtures.ts";

const BROWS = Array.from({ length: 12 }, (_, i) => `eyebrow${String(i + 1).padStart(3, "0")}`);
const LASHES = Array.from({ length: 4 }, (_, i) => `eyelashes0${i + 1}`);
const of = (kind: string) => hairManifest.styles.filter((s) => s.kind === kind);

describe("the hair pack's brows and lashes", () => {
  it("list MakeHuman's twelve system eyebrows and four eyelashes, after the scalp styles", () => {
    expect(of("brows").map((s) => s.id)).toEqual(BROWS);
    expect(of("lashes").map((s) => s.id)).toEqual(LASHES);
    const kinds = hairManifest.styles.map((s) => s.kind);
    expect(kinds.lastIndexOf("scalp")).toBeLessThan(kinds.indexOf("brows"));
    expect(kinds.lastIndexOf("brows")).toBeLessThan(kinds.indexOf("lashes"));
    for (const s of [...of("brows"), ...of("lashes")]) {
      expect(s.label.length, s.id).toBeGreaterThan(0);
      expect(s.tags.length, s.id).toBeGreaterThan(0);
    }
  });

  it("carry none of a scalp style's measured fields: they have no hairline, growth or fins", () => {
    for (const s of [...of("brows"), ...of("lashes")])
      for (const key of HAIR_FIELD_KEYS) expect(s.layout[key], `${s.id}: ${key}`).toBeUndefined();
    for (const s of of("scalp"))
      for (const key of HAIR_FIELD_KEYS) expect(s.layout[key], `${s.id}: ${key}`).toBeDefined();
  });

  it("bind to the base mesh and hide none of it", () => {
    const assets = loadHairFixtureAssets();
    const n = bodyManifest.vertexCount;
    for (const s of [...of("brows"), ...of("lashes")]) {
      const a = assets.hair?.bound.get(s.id);
      expect(a, s.id).toBeDefined();
      if (!a) continue;
      expect(a.hair, `${s.id} has no scalp fields`).toBeUndefined();
      expect(a.deleteVerts.length, s.id).toBe(0);
      expect(Math.max(...a.refVerts), s.id).toBeLessThan(n);
      expect(a.refVerts.length, s.id).toBe(s.vertexCount * 3);
    }
    // MakeHuman's eyebrows are 124-vertex decals, its lashes 250 or so.
    for (const s of of("brows")) expect(s.vertexCount, s.id).toBe(124);
    for (const s of of("lashes")) expect(s.vertexCount, s.id).toBeGreaterThan(200);
  });

  it("ship an alpha mask in white, for the figure's hair colour to tint", async () => {
    for (const s of [...of("brows"), ...of("lashes")]) {
      const { data } = await sharp(path.join(hairDir, s.material.texture as string))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let covered = 0;
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i + 3] as number) < 20) continue;
        covered++;
        if (Math.min(data[i] as number, data[i + 1] as number, data[i + 2] as number) < 235) dark++;
      }
      const share = covered / (data.length / 4);
      expect(share, `${s.id} coverage`).toBeGreaterThan(0.02);
      expect(share, `${s.id} coverage`).toBeLessThan(0.45);
      // The source's black is a colour the renderer must not inherit.
      expect(dark / covered, `${s.id} dark texels`).toBeLessThan(0.02);
      expect(s.material.transparent || s.material.alphaToCoverage, s.id).toBe(true);
    }
  });

  it("are small: a brow or a lash under 80 KB, all sixteen under 700 KB", () => {
    let total = 0;
    for (const s of [...of("brows"), ...of("lashes")]) {
      const bytes =
        fs.statSync(path.join(hairDir, s.file)).size +
        fs.statSync(path.join(hairDir, s.material.texture as string)).size;
      expect(bytes, s.id).toBeLessThan(80 * 1024);
      total += bytes;
    }
    expect(total).toBeLessThan(700 * 1024);
  });

  it("prove their CC0 from the files' own headers, in the pack's provenance", () => {
    const provenance = fs.readFileSync(path.join(hairDir, "PROVENANCE.md"), "utf8");
    expect(provenance).toContain("`eyebrows/`");
    expect(provenance).toContain("`eyelashes/`");
    // Each style's texture is admitted as a binary file of a team asset (every text file of the
    // style carries the CC0 header), and its own .mhmat by that header: both named on their lines.
    const line = (evidence: string) =>
      provenance.split("\n").find((l) => l.includes(`— ${evidence}:`)) ?? "";
    const binaries = line("A: binary file of a team asset");
    const headers = line('A: file header "This asset was explicitly released as CC0"');
    for (const [dir, ids] of [
      ["eyebrows", BROWS],
      ["eyelashes", LASHES],
    ] as const)
      for (const id of ids) {
        expect(binaries, id).toContain(`${dir}/${id}/${id}.png`);
        expect(headers, id).toContain(`${dir}/${id}/${id}.mhmat`);
      }
  });
});
