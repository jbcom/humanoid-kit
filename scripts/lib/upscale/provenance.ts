/**
 * The upscale manifest entry (docs/evidence/upscale.md): one per upscaled
 * texture, naming what it was made from (and its hash), by what code and
 * version, with which weights (none), under what licence, with what
 * parameters, how it fared at each gate, and the output's hash.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { ChannelClass } from "./methods.ts";

export const MANIFEST_FILE = "upscale-manifest.json";
export const MANIFEST_FORMAT = "humanoid-kit-upscale/1";

export const sha256File = (file: string) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** The code that computes an upscale; its version is the hash of its source files. */
const METHOD_SOURCES = ["raster.ts", "methods.ts"].map((f) => path.join(import.meta.dirname, f));

export interface Tool {
  name: string;
  version: string;
  licence: string;
}

/** What made the pixels: this kit's own methods (no learned weights). */
export function methodTool(): Tool {
  const h = createHash("sha256");
  for (const f of METHOD_SOURCES) h.update(fs.readFileSync(f));
  return {
    name: "humanoid-kit scripts/lib/upscale (raster.ts, methods.ts)",
    version: `sha256:${h.digest("hex")}`,
    licence: "MIT",
  };
}

/** What decoded the source and encoded the output (it changes no pixel beyond 16-bit rounding). */
export const codecTool = (): Tool => ({
  name: "sharp (libvips)",
  version: `${sharp.versions.sharp ?? "?"} (libvips ${sharp.versions.vips})`,
  licence: "Apache-2.0 (libvips LGPL-3.0-or-later)",
});

export interface UpscaleEntry {
  /** The source, relative to the system assets directory, and its hash. */
  source: string;
  sourceSha256: string;
  sourceSize: [number, number];
  /** The output, relative to the manifest's directory, and its hash. */
  output: string;
  outputSha256: string;
  outputSize: [number, number];
  /** The source's licence, which the output keeps: the methods add no content of their own. */
  licence: string;
  class: ChannelClass;
  method: string;
  tool: Tool;
  codec: Tool;
  /** Learned weights used, if any (none for this kit's methods). */
  weights: { name: string; sha256: string; licence: string } | null;
  parameters: Record<string, number | boolean | string>;
  /** Every gate's reading, and whether all passed. */
  gates: Record<string, unknown>;
  pass: boolean;
}

/** `scripts/upscale.ts`'s manifest of the upscales it wrote for inspection. */
export interface UpscaleManifest {
  format: typeof MANIFEST_FORMAT;
  entries: UpscaleEntry[];
}
