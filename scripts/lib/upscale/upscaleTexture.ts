/**
 * Upscales one texture by its channel class and judges it by every gate, with
 * its provenance manifest entry: what `scripts/upscale.ts` runs on each texture
 * whose source falls short of the edge it needs (docs/evidence/upscale.md).
 */
import path from "node:path";
import {
  albedoSpace,
  COLOUR_RANGE,
  newDetail,
  normalInterior,
  roundTripAlbedo,
  roundTripCoverage,
  roundTripNormal,
  slopeSpace,
} from "./gates.ts";
import {
  BACK_PROJECTIONS,
  type ChannelClass,
  METHOD,
  upscaleAlbedo,
  upscaleNormal,
} from "./methods.ts";
import { codecTool, methodTool, sha256File, type UpscaleEntry } from "./provenance.ts";
import { channel, type Raster, readRaster } from "./raster.ts";

export interface UpscaleRequest {
  /** The source image (absolute) and the system-assets directory it lies in. */
  source: string;
  systemDir: string;
  /** A coverage mask travels as an albedo whose alpha is a cut-out (`cutout`). */
  cls: Exclude<ChannelClass, "coverage">;
  /** An albedo's alpha is a cut-out, upscaled and gated as coverage. */
  cutout: boolean;
  /** The longest edge wanted. */
  edge: number;
  /** Why: the framing it is judged at and the edge that needs. */
  framing: string;
  needed: number;
}

/** The upscaled raster and its manifest entry, short of the output's name and hash (the caller encodes it). */
export async function upscaleTexture(
  req: UpscaleRequest,
): Promise<{ raster: Raster; entry: Omit<UpscaleEntry, "output" | "outputSha256"> }> {
  const src = await readRaster(req.source);
  const sourceEdge = Math.max(src.width, src.height);
  const width = Math.round((src.width * req.edge) / sourceEdge);
  const height = Math.round((src.height * req.edge) / sourceEdge);
  let out: Raster;
  let gates: Record<string, unknown>;
  let pass: boolean;
  if (req.cls === "normal") {
    out = upscaleNormal(src, width, height);
    const roundTrip = roundTripNormal(src, out);
    const detail = newDetail(src, out, slopeSpace, normalInterior(src, width, height));
    gates = { roundTrip, newDetail: detail };
    pass = roundTrip.pass && detail.pass;
  } else {
    out = upscaleAlbedo(src, width, height, req.cutout);
    const roundTrip = roundTripAlbedo(src, out);
    const detail = newDetail(src, out, albedoSpace, undefined, COLOUR_RANGE);
    const alpha = src.channels === 4 ? roundTripCoverage(channel(src, 3), channel(out, 3)) : null;
    gates = { roundTrip, newDetail: detail, ...(alpha && { alpha }) };
    pass = roundTrip.pass && detail.pass && (alpha?.pass ?? true);
  }
  return {
    raster: out,
    entry: {
      source: path.relative(req.systemDir, req.source),
      sourceSha256: sha256File(req.source),
      sourceSize: [src.width, src.height],
      outputSize: [width, height],
      licence: "CC0-1.0",
      class: req.cls,
      method: METHOD[req.cls],
      tool: methodTool(),
      codec: codecTool(),
      weights: null,
      parameters: {
        scale: req.edge / sourceEdge,
        lanczosLobes: 3,
        backProjections: BACK_PROJECTIONS,
        cutout: req.cutout,
        framing: req.framing,
        neededEdge: req.needed,
      },
      gates,
      pass,
    },
  };
}
