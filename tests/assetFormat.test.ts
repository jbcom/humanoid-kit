import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AssetFormatError,
  type BodyManifest,
  gunzip,
  parseHumanoidAssets,
} from "../src/format/assetFormat.ts";
import {
  adultManifest,
  adultPackData,
  bodyDir,
  bodyManifest,
  bodyPackData,
  readGzipPackFile,
  readPackFile,
} from "./fixtures.ts";

const pack = (manifest: BodyManifest = bodyManifest) => ({ ...bodyPackData(), manifest });
const clone = (): BodyManifest => structuredClone(bodyManifest);

describe("parseHumanoidAssets", () => {
  it("parses the shipped body pack", () => {
    const a = parseHumanoidAssets(pack());
    expect(a.positions.length).toBe(bodyManifest.vertexCount * 3);
    expect(a.attachments.size).toBeGreaterThan(0);
  });

  it("decodes every target to ascending in-range indices", () => {
    const a = parseHumanoidAssets(pack());
    expect(a.targets.size).toBe(bodyManifest.targets.entries.length);
    const bad: string[] = [];
    for (const t of a.targets.values()) {
      let ok = t.deltas.length === t.indices.length * 3;
      for (let i = 1; ok && i < t.indices.length; i++)
        ok = (t.indices[i] as number) > (t.indices[i - 1] as number);
      if (!ok || (t.indices.at(-1) ?? 0) >= bodyManifest.vertexCount) bad.push(t.name);
    }
    expect(bad).toEqual([]);
  });

  it("decompresses with the platform's gzip decoder exactly as zlib does", async () => {
    const file = path.join(bodyDir, bodyManifest.targets.file);
    const viaPlatform = new Uint8Array(await gunzip(readPackFile(file)));
    expect(Buffer.from(viaPlatform).equals(Buffer.from(readGzipPackFile(file)))).toBe(true);
  });

  it("rejects a range that runs past the buffer", () => {
    const m = clone();
    m.body.layout.positions.byteLength += 4096 * 1024 * 1024;
    expect(() => parseHumanoidAssets(pack(m))).toThrow(AssetFormatError);
  });

  it("rejects a misaligned range instead of truncating it", () => {
    const m = clone();
    m.body.layout.uvs.byteLength -= 2;
    expect(() => parseHumanoidAssets(pack(m))).toThrow(/misaligned/);
  });

  it("rejects target indices beyond the base mesh", () => {
    const m = clone();
    const t = m.targets.entries[0];
    if (!t) throw new Error("no targets");
    // One index delta of 65000 into an otherwise blank targets file.
    const corrupt = new Uint8Array(bodyPackData().targets.byteLength);
    new DataView(corrupt.buffer).setUint16(t.offset, 65000, true);
    expect(() => parseHumanoidAssets({ ...pack(m), targets: corrupt.buffer })).toThrow(
      /out of range/,
    );
  });

  it("rejects index deltas that run past 65535", () => {
    const m = clone();
    const t = m.targets.entries.find((e) => e.count >= 2);
    if (!t) throw new Error("no multi-vertex target");
    const corrupt = new Uint8Array(bodyPackData().targets.byteLength);
    const view = new DataView(corrupt.buffer);
    view.setUint16(t.offset, 60000, true);
    view.setUint16(t.offset + 2, 60000, true);
    expect(() => parseHumanoidAssets({ ...pack(m), targets: corrupt.buffer })).toThrow(/65535/);
  });

  it("rejects a truncated targets file and an unknown encoding", () => {
    const full = bodyPackData().targets;
    expect(() =>
      parseHumanoidAssets({ ...pack(), targets: full.slice(0, full.byteLength - 8) }),
    ).toThrow(/exceeds/);
    const m = clone();
    (m.targets as { encoding: string }).encoding = "raw";
    expect(() => parseHumanoidAssets(pack(m))).toThrow(/unsupported target encoding/);
  });

  it("rejects attachment face indices beyond the attachment", () => {
    const m = clone();
    const a = m.attachments.entries[0];
    if (!a) throw new Error("no attachments");
    a.vertexCount = 3; // faces now index past the declared vertex count
    expect(() => parseHumanoidAssets(pack(m))).toThrow(AssetFormatError);
  });

  it("rejects a slider that drives nothing in the loaded packs", () => {
    const m = clone();
    const s = m.sliders[0]?.groups[0]?.sliders[0];
    if (!s) throw new Error("no sliders");
    s.id = "not-a-macro";
    expect(() => parseHumanoidAssets(pack(m))).toThrow(/drives nothing/);
    // An adult slider merged without its modifier, e.g. from a mismatched manifest.
    const adult = structuredClone(adultManifest);
    adult.modifiers = [];
    expect(() => parseHumanoidAssets(pack(), { ...adultPackData(), manifest: adult })).toThrow(
      /drives nothing/,
    );
  });

  it("refuses an adult anatomy pack built for another body", () => {
    const other = { ...adultManifest, bodySha256: "0".repeat(64) };
    expect(() =>
      parseHumanoidAssets(pack(), { manifest: other, targets: new ArrayBuffer(0) }),
    ).toThrow(/different body pack/);
  });
});
