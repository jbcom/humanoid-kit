/**
 * The animation pack (`humanoid-kit-animations`) in memory: its manifest at
 * once, each clip's binary when it is first asked for. A clip is figure
 * independent, so one library serves every figure, and binding a clip to a rig
 * is by bone name (`AnimationLibrary.load`).
 */
import {
  AssetFormatError,
  fetchGzip,
  fetchOk,
  type PackLocation,
  packResolver,
} from "../format/assetFormat.ts";
import { type AnimationClip, type AnimationManifest, type ClipEntry, parseClip } from "./clip.ts";

export interface AnimationLibrary {
  readonly manifest: AnimationManifest;
  /** A clip's manifest entry, or undefined for an id the pack does not have. */
  entry(id: string): ClipEntry | undefined;
  /**
   * The clip bound to `bones` (a rig's bone names, `rigData(assets).bones`),
   * fetched on first use and then kept: a clip is fetched once, however many
   * figures play it. A failed fetch is forgotten, so a later request retries.
   */
  load(id: string, bones: readonly string[]): Promise<AnimationClip>;
  /** The clip if it has already been loaded for `bones`, without fetching. */
  loaded(id: string, bones: readonly string[]): AnimationClip | undefined;
}

/** A library over `manifest`, whose clips' binaries `fetchBinary` brings in by entry. */
export function createAnimationLibrary(
  manifest: AnimationManifest,
  fetchBinary: (entry: ClipEntry) => Promise<ArrayBuffer>,
): AnimationLibrary {
  const entries = new Map(manifest.clips.map((c) => [c.id, c]));
  const binaries = new Map<string, Promise<ArrayBuffer>>();
  /** Per rig (by its bone names' identity), each clip bound to it, and the binding in progress. */
  const bound = new WeakMap<readonly string[], Map<string, AnimationClip>>();
  const binding = new WeakMap<readonly string[], Map<string, Promise<AnimationClip>>>();
  const entry = (id: string) => entries.get(id);
  const loaded = (id: string, bones: readonly string[]) => bound.get(bones)?.get(id);
  const forRig = <T>(
    maps: WeakMap<readonly string[], Map<string, T>>,
    bones: readonly string[],
  ) => {
    let m = maps.get(bones);
    if (!m) {
      m = new Map();
      maps.set(bones, m);
    }
    return m;
  };
  const load = (id: string, bones: readonly string[]): Promise<AnimationClip> => {
    const have = loaded(id, bones);
    if (have) return Promise.resolve(have);
    const e = entries.get(id);
    if (!e) return Promise.reject(new AssetFormatError(`no animation clip ${id}`));
    const pending = forRig(binding, bones);
    let p = pending.get(id);
    if (!p) {
      let bin = binaries.get(id);
      if (!bin) {
        bin = fetchBinary(e);
        binaries.set(id, bin);
        bin.catch(() => binaries.delete(id));
      }
      p = bin.then((buffer) => {
        const clip = parseClip(e, bones, buffer);
        forRig(bound, bones).set(id, clip);
        return clip;
      });
      pending.set(id, p);
      p.catch(() => pending.delete(id));
    }
    return p;
  };
  return { manifest, entry, load, loaded };
}

/**
 * Fetches the animation pack's manifest; each clip's binary is fetched when a
 * figure first plays it.
 *
 *     import { animationsPack } from "humanoid-kit-animations";
 *     const animations = await loadAnimationLibrary(animationsPack);
 */
export async function loadAnimationLibrary(pack: PackLocation): Promise<AnimationLibrary> {
  const where = packResolver(pack);
  const manifest = (await (await fetchOk(where.manifest)).json()) as AnimationManifest;
  if (manifest.version !== 1)
    throw new AssetFormatError(`animation pack version ${String(manifest.version)} is not 1`);
  return createAnimationLibrary(manifest, (e) => fetchGzip(where.file(e.file)));
}
