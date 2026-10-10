/**
 * The eye materials pack (`humanoid-kit-eyes`) in memory: its manifest, and
 * where each material's texture is. A material supplies an iris's pattern and a
 * sclera's detail on the eye shader (`EyeMaterial`), never its colour: the
 * colour is the recipe's (`eyes.iris`, `eyes.scleraWarmth`), measured, and the
 * material's numbers say how its texture maps onto that.
 */
import {
  AssetFormatError,
  fetchOk,
  type PackLocation,
  packResolver,
} from "../format/assetFormat.ts";
import type { Rgb } from "../surface/skinTone.ts";

/** One material of the pack. */
export interface EyeMaterialEntry {
  id: string;
  title: string;
  author: string;
  /** ISO date its page says it was created. */
  created: string;
  /** What the texture is, for a picker: a human iris, a slit pupil, a toon eye, a creature's. */
  tags: string[];
  /** The texture, in the pack's `data` directory (WebP with the cornea's cut in its alpha). */
  file: string;
  sha256: string;
  /**
   * Whether the texture has an iris to speak of (an edge between a disc and a
   * different ring around it). A material without one is all sclera detail:
   * eyes of a single glowing or blank colour.
   */
  hasIris: boolean;
  /** The iris's radius in texture units (the texture is 1 across), from its centre. */
  irisRadius: number;
  /**
   * What multiplies the texture's luminance in the iris so that `eyes.iris` is the
   * iris's mean colour, as it is for the built-in texture.
   */
  irisGain: number;
  /** The same for the sclera's brightness. */
  scleraGain: number;
  /** The sclera's colour against the built-in one's, per channel: 1 is the same. */
  scleraTint: Rgb;
  /**
   * The iris colour (`eyes.iris`) at which the material shows the colour its texture
   * was painted in, for a picker's "as painted". Nothing applies it.
   */
  paintedIris: Rgb;
  source: {
    archive: string;
    archiveSha256: string;
    /** The texture's path in the archive. */
    file: string;
    /** The asset's page on makehumancommunity.org. */
    page: string;
    licence: string;
  };
}

export interface EyeManifest {
  version: 1;
  /** Where each eye's iris is in the texture, (u, v) with v up; every material shares the layout. */
  centres: [[number, number], [number, number]];
  materials: EyeMaterialEntry[];
}

export interface EyeLibrary {
  readonly manifest: EyeManifest;
  /** A material's entry, or undefined for an id the pack does not have. */
  entry(id: string): EyeMaterialEntry | undefined;
  /** Where the material's texture is. */
  textureUrl(id: string): string;
}

/** A library over `manifest`, whose textures `url` locates by file name. */
export function createEyeLibrary(manifest: EyeManifest, url: (file: string) => string): EyeLibrary {
  const entries = new Map(manifest.materials.map((m) => [m.id, m]));
  return {
    manifest,
    entry: (id) => entries.get(id),
    textureUrl(id) {
      const e = entries.get(id);
      if (!e) throw new AssetFormatError(`no eye material ${id}`);
      return url(e.file);
    },
  };
}

/**
 * Fetches the eye pack's manifest; each texture is loaded when a figure first
 * wears its material.
 *
 *     import { eyesPack } from "humanoid-kit-eyes";
 *     const eyes = await loadEyeLibrary(eyesPack);
 */
export async function loadEyeLibrary(pack: PackLocation): Promise<EyeLibrary> {
  const where = packResolver(pack);
  const manifest = (await (await fetchOk(where.manifest)).json()) as EyeManifest;
  if (manifest.version !== 1)
    throw new AssetFormatError(`eye pack version ${String(manifest.version)} is not 1`);
  return createEyeLibrary(manifest, (file) => where.file(file));
}
