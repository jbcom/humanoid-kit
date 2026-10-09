import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AssetFormatError,
  type BodyManifest,
  parseHumanoidAssets,
} from "../src/format/assetFormat.ts";
import { adultManifest, bodyManifest } from "./fixtures.ts";

const dir = path.resolve(import.meta.dirname, "../packs/body/data");
const read = (f: string) => {
  const b = fs.readFileSync(path.join(dir, f));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const pack = (manifest: BodyManifest = bodyManifest) => ({
  manifest,
  body: read("body.bin"),
  targets: read("targets.bin"),
  attachments: read("attachments.bin"),
});
const clone = (): BodyManifest => structuredClone(bodyManifest);

describe("parseHumanoidAssets", () => {
  it("parses the shipped body pack", () => {
    const a = parseHumanoidAssets(pack());
    expect(a.positions.length).toBe(bodyManifest.vertexCount * 3);
    expect(a.attachments.size).toBeGreaterThan(0);
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
    // Write an index past the base mesh into the first target of an otherwise blank targets file.
    const t = m.targets.entries[0];
    if (!t) throw new Error("no targets");
    const corrupt = new Uint8Array(read("targets.bin").byteLength);
    new Uint16Array(corrupt.buffer, t.offset, 1)[0] = 65000;
    expect(() => parseHumanoidAssets({ ...pack(m), targets: corrupt.buffer })).toThrow(
      /out of range/,
    );
  });

  it("rejects attachment face indices beyond the attachment", () => {
    const m = clone();
    const a = m.attachments.entries[0];
    if (!a) throw new Error("no attachments");
    a.vertexCount = 3; // faces now index past the declared vertex count
    expect(() => parseHumanoidAssets(pack(m))).toThrow(AssetFormatError);
  });

  it("refuses an adult anatomy pack built for another body", () => {
    const other = { ...adultManifest, bodySha256: "0".repeat(64) };
    expect(() =>
      parseHumanoidAssets(pack(), { manifest: other, targets: new ArrayBuffer(0) }),
    ).toThrow(/different body pack/);
  });
});
