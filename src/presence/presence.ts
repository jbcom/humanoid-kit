/**
 * Presence: what each figure tells the scene around it (docs/PRESENCE.md).
 *
 * A figure describes itself (where it stands and faces, its anchors and
 * footprint, its measured skin reflectance, whether it is an adult); the
 * scene, which alone knows its goals and every figure in it, decides what to
 * do. One registry serves every consumer: lighting, shadows, cameras,
 * awareness, audio and game logic. Continuous state is read on demand;
 * discrete changes (proximity) are events, evaluated only for subscribers.
 * Framework-free.
 */

export type Vec3 = [number, number, number];

export type AnchorName =
  | "head"
  | "face"
  | "chest"
  | "leftHand"
  | "rightHand"
  | "leftFoot"
  | "rightFoot";

export interface FigurePresence {
  id: string;
  /** Where the figure stands, on the ground, in world space (metres). */
  position: Vec3;
  /** Unit vector the figure faces. */
  facing: Vec3;
  bounds: { min: Vec3; max: Vec3 };
  /** Named anchors in world space. */
  anchors: Record<AnchorName, Vec3>;
  /** Ground contact: foot positions (x, z) and an approximate footprint radius. */
  footprint: { points: [number, number][]; radius: number };
  /** Measured skin appearance: linear albedo, its luminance, specular F0. Never a category. */
  appearance: { albedo: Vec3; luminance: number; specular: number };
  /** Radius of the face's metering region around `anchors.face`, metres. */
  faceRadius: number;
  /** The figure's age bracket, for interaction contracts that the age policy limits. */
  adult: boolean;
}

/** A figure as published, with the velocity the registry measured. */
export type PublishedPresence = FigurePresence & { velocity: Vec3 };

export interface ProximityEvent {
  type: "enter" | "leave";
  /** The two figures, in id order. */
  ids: [string, string];
  /** Their distance on the ground when the event was raised. */
  distance: number;
}

export interface PresenceRegistry {
  /** Publishes or replaces a figure's presence. */
  set(presence: FigurePresence): void;
  remove(id: string): void;
  get(id: string): PublishedPresence | undefined;
  all(): PublishedPresence[];
  /**
   * Advances to `seconds` (the render loop's clock): measures velocities since
   * the previous tick and raises proximity events.
   */
  tick(seconds: number): void;
  /**
   * Calls `listener` when two figures come within `radius` metres on the ground
   * and when they part beyond 1.1 × radius. Returns the unsubscribe function.
   */
  onProximity(radius: number, listener: (e: ProximityEvent) => void): () => void;
}

/** Leaving takes this much more distance than entering, so edges do not flicker. */
const HYSTERESIS = 1.1;

const groundDistance = (a: FigurePresence, b: FigurePresence) =>
  Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);

export function createPresenceRegistry(): PresenceRegistry {
  const figures = new Map<string, PublishedPresence>();
  const previous = new Map<string, Vec3>();
  let lastTick: number | null = null;
  const proximity = new Set<{
    radius: number;
    listener: (e: ProximityEvent) => void;
    near: Map<string, [string, string]>;
  }>();

  return {
    set(presence) {
      figures.set(presence.id, {
        ...presence,
        velocity: figures.get(presence.id)?.velocity ?? [0, 0, 0],
      });
    },
    remove(id) {
      figures.delete(id);
      previous.delete(id);
    },
    get: (id) => figures.get(id),
    all: () => [...figures.values()],
    tick(seconds) {
      const dt = lastTick === null ? 0 : seconds - lastTick;
      for (const f of figures.values()) {
        const before = previous.get(f.id);
        f.velocity =
          before && dt > 0
            ? [
                (f.position[0] - before[0]) / dt,
                (f.position[1] - before[1]) / dt,
                (f.position[2] - before[2]) / dt,
              ]
            : [0, 0, 0];
        previous.set(f.id, [...f.position]);
      }
      lastTick = seconds;
      if (proximity.size === 0) return;
      const list = [...figures.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
      for (const sub of proximity) {
        const now = new Map<string, number>();
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i] as PublishedPresence;
            const b = list[j] as PublishedPresence;
            now.set(`${a.id}\u0000${b.id}`, groundDistance(a, b));
          }
        for (const [key, d] of now) {
          const ids = key.split("\u0000") as [string, string];
          if (!sub.near.has(key) && d <= sub.radius) {
            sub.near.set(key, ids);
            sub.listener({ type: "enter", ids, distance: d });
          } else if (sub.near.has(key) && d > sub.radius * HYSTERESIS) {
            sub.near.delete(key);
            sub.listener({ type: "leave", ids, distance: d });
          }
        }
        // A pair whose figure was removed has parted.
        for (const [key, ids] of sub.near)
          if (!now.has(key)) {
            sub.near.delete(key);
            sub.listener({ type: "leave", ids, distance: Number.POSITIVE_INFINITY });
          }
      }
    },
    onProximity(radius, listener) {
      const sub = { radius, listener, near: new Map<string, [string, string]>() };
      proximity.add(sub);
      return () => proximity.delete(sub);
    },
  };
}

/** Figures that stand together: single linkage on the ground within `distance`. */
export function presenceGroups(presences: readonly FigurePresence[], distance: number): string[][] {
  const parent = new Map(presences.map((p) => [p.id, p.id]));
  const find = (id: string): string => {
    const up = parent.get(id) as string;
    if (up === id) return id;
    const root = find(up);
    parent.set(id, root);
    return root;
  };
  for (let i = 0; i < presences.length; i++)
    for (let j = i + 1; j < presences.length; j++) {
      const a = presences[i] as FigurePresence;
      const b = presences[j] as FigurePresence;
      if (groundDistance(a, b) <= distance) parent.set(find(a.id), find(b.id));
    }
  const groups = new Map<string, string[]>();
  for (const p of presences) {
    const root = find(p.id);
    groups.set(root, [...(groups.get(root) ?? []), p.id]);
  }
  return [...groups.values()];
}

/** One contact shadow on the ground: a soft disc at (x, z). */
export interface ContactPoint {
  x: number;
  z: number;
  radius: number;
  strength: number;
}

/**
 * Contact shadows for every figure's footprint. Sample them with
 * `sampleGroundOcclusion`, which pools them with `max`, so figures walking
 * together share one shadow that separates as they part, and overlap never
 * darkens twice.
 */
export function groundOcclusion(
  presences: readonly FigurePresence[],
  options: { strength?: number; spread?: number } = {},
): ContactPoint[] {
  const strength = options.strength ?? 0.6;
  const spread = options.spread ?? 2.5;
  return presences.flatMap((p) =>
    p.footprint.points.map(([x, z]) => ({ x, z, radius: p.footprint.radius * spread, strength })),
  );
}

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Ground occlusion (0 open … 1 fully shadowed) at (x, z): the strongest contact point there. */
export function sampleGroundOcclusion(
  points: readonly ContactPoint[],
  x: number,
  z: number,
): number {
  let o = 0;
  for (const p of points) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.radius) o = Math.max(o, p.strength * (1 - smoothstep(0, p.radius, d)));
  }
  return o;
}

export interface FaceMeter {
  id: string;
  /** The face's metering region. */
  center: Vec3;
  radius: number;
  /** Diffuse luminance of the skin (linear, 0–1). */
  reflectance: number;
  /** Where the face should sit relative to middle grey: log2(reflectance / 0.18). */
  skinZoneEV: number;
  /** Apparent size from the viewer (solid-angle proxy); larger matters more. */
  weight: number;
}

/**
 * A face-priority metering report (research/SKIN-RENDERING.md §4.4): every
 * face's region, measured reflectance and intended zone, heaviest first, and
 * the deepest face. A scene exposes for grey, checks each face against its own
 * zone and adds light where one falls short. It never pulls every face to one
 * luminance, which is what flattens a mixed group.
 */
export function faceMetering(
  presences: readonly FigurePresence[],
  viewer: { position: Vec3 },
): { faces: FaceMeter[]; deepest: string | null } {
  const faces = presences.map((p) => {
    const c = p.anchors.face;
    const d = Math.max(
      1e-3,
      Math.hypot(c[0] - viewer.position[0], c[1] - viewer.position[1], c[2] - viewer.position[2]),
    );
    const reflectance = Math.max(1e-4, p.appearance.luminance);
    return {
      id: p.id,
      center: c,
      radius: p.faceRadius,
      reflectance,
      skinZoneEV: Math.log2(reflectance / 0.18),
      weight: (p.faceRadius / d) ** 2,
    };
  });
  faces.sort((a, b) => b.weight - a.weight);
  const deepest = faces.reduce<FaceMeter | null>(
    (lo, f) => (lo === null || f.reflectance < lo.reflectance ? f : lo),
    null,
  );
  return { faces, deepest: deepest?.id ?? null };
}
