/**
 * Which controls shape each part of the figure, derived from the controls
 * themselves.
 *
 * A slider group's modifier targets move exactly the vertices of the feature
 * it shapes (the nose targets the nose, the left-hand targets the left hand),
 * so the group that moves a vertex most, relative to how far it moves
 * anything, is the feature at that vertex. Among groups that reach a vertex
 * comparably, the one reaching the fewest vertices wins: the nose, not the
 * head-scale group that also moves the nose. No part is mapped by hand, so the
 * map follows the packs. See docs/ARCHITECTURE.md, "Picking a feature".
 */
import type { HumanoidAssets } from "../format/assetFormat.ts";

/** A slider group of the merged taxonomy, by task and group id. */
export interface FeatureRef {
  task: string;
  group: string;
  label: string;
}

export interface FeatureMap {
  features: FeatureRef[];
  /** Per base vertex, an index into `features`, or `NO_FEATURE`. */
  vertexFeature: Uint8Array;
}

export const NO_FEATURE = 255;

/**
 * Modifier groups that are whole-figure archetypes (MakeHuman's body shapes)
 * rather than a part of the figure: never a feature, never randomised.
 */
export const ARCHETYPE_MODIFIER_GROUPS: ReadonlySet<string> = new Set(["bodyshapes"]);

/** A group owns a vertex it reaches by at least this share of the best group's reach there. */
const CONTEST = 0.5;
/** A group's footprint counts the vertices it reaches by at least this much. */
const FOOTPRINT = 0.25;
/** Below this reach, no group owns a vertex. */
const FLOOR = 0.2;

export function buildFeatureMap(assets: HumanoidAssets): FeatureMap {
  if (!assets.modifierTargetsLoaded)
    throw new Error("the feature map needs the modifier targets, which have not loaded yet");
  const n = assets.manifest.vertexCount;
  const features: FeatureRef[] = [];
  const reaches: Float32Array[] = [];
  for (const task of assets.sliders) {
    for (const group of task.groups) {
      const targets = new Set<string>();
      for (const s of group.sliders) {
        const m = s.kind === "modifier" ? assets.modifiers.get(s.id) : undefined;
        // Adult-only controls never place a feature: a tap must not open them.
        if (!m || m.adultOnly || ARCHETYPE_MODIFIER_GROUPS.has(m.group)) continue;
        targets.add(m.hi);
        if (m.lo) targets.add(m.lo);
      }
      if (targets.size === 0) continue;
      const reach = new Float32Array(n);
      for (const name of targets) {
        const t = assets.targets.get(name);
        if (!t) throw new Error(`the feature map needs target ${name}, which is not loaded`);
        let peak = 0;
        const mags = new Float32Array(t.indices.length);
        for (let i = 0; i < t.indices.length; i++) {
          const m = Math.hypot(
            t.deltas[i * 3] as number,
            t.deltas[i * 3 + 1] as number,
            t.deltas[i * 3 + 2] as number,
          );
          mags[i] = m;
          if (m > peak) peak = m;
        }
        if (peak === 0) continue;
        for (let i = 0; i < t.indices.length; i++) {
          const v = t.indices[i] as number;
          const r = (mags[i] as number) / peak;
          if (r > (reach[v] as number)) reach[v] = r;
        }
      }
      features.push({ task: task.id, group: group.id, label: group.label });
      reaches.push(reach);
    }
  }
  if (features.length >= NO_FEATURE) throw new Error(`too many feature groups: ${features.length}`);
  const footprint = reaches.map((r) => r.reduce((c, x) => (x >= FOOTPRINT ? c + 1 : c), 0));
  const vertexFeature = new Uint8Array(n).fill(NO_FEATURE);
  for (let v = 0; v < n; v++) {
    let best = 0;
    for (const r of reaches) if ((r[v] as number) > best) best = r[v] as number;
    if (best < FLOOR) continue;
    let owner = -1;
    reaches.forEach((r, g) => {
      if ((r[v] as number) < best * CONTEST) return;
      if (owner < 0 || (footprint[g] as number) < (footprint[owner] as number)) owner = g;
    });
    vertexFeature[v] = owner;
  }
  return { features, vertexFeature };
}
