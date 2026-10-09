/**
 * Presence: what each figure tells the scene around it (docs/PRESENCE.md).
 *
 * A figure describes itself (where it stands and faces, its anchors and
 * footprint, its measured skin reflectance, whether it is an adult); the
 * scene, which alone knows its goals and every figure in it, decides what to
 * do. One registry serves every consumer: lighting, shadows, cameras,
 * awareness, audio and game logic. Continuous state is read on demand;
 * discrete changes (proximity) are events, evaluated only for subscribers.
 * The per-frame paths (`set`, `tick`, `all`, `groundOcclusion` with `into`)
 * allocate nothing once figures have joined. Framework-free.
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
  /**
   * Publishes or replaces a figure's presence. The registry keeps the objects
   * it is given by reference (anchors, bounds, footprint) and measures
   * `velocity` itself, so a publisher that updates one presence in place every
   * frame (see `placePresence`'s `out`) allocates nothing.
   */
  set(presence: FigurePresence): void;
  remove(id: string): void;
  get(id: string): PublishedPresence | undefined;
  /**
   * Every published figure. The same array until a figure joins or leaves, and
   * each entry is updated in place as figures move: copy what you keep.
   */
  all(): readonly PublishedPresence[];
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

/** Pairs are keyed by their two slots: `low * SLOT_STRIDE + high`. */
const SLOT_STRIDE = 0x10000;

const groundDistance = (a: FigurePresence, b: FigurePresence) =>
  Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);

export function createPresenceRegistry(): PresenceRegistry {
  const figures = new Map<string, PublishedPresence>();
  /** Each figure holds a numeric slot while published, so pairs key without strings. */
  const slotOf = new Map<string, number>();
  const slots: (PublishedPresence | undefined)[] = [];
  const before: (Vec3 | undefined)[] = [];
  const freeSlots: number[] = [];
  /** Slots whose figure was removed, and its id, until the next tick has reported the pairs they ended. */
  const retired: number[] = [];
  const retiredId: string[] = [];
  let list: readonly PublishedPresence[] = [];
  let lastTick: number | null = null;
  const proximity = new Set<{
    radius: number;
    listener: (e: ProximityEvent) => void;
    near: Set<number>;
  }>();

  const idOf = (slot: number) => slots[slot]?.id ?? (retiredId[slot] as string);
  const pairIds = (a: number, b: number): [string, string] => {
    const x = idOf(a);
    const y = idOf(b);
    return x < y ? [x, y] : [y, x];
  };

  return {
    set(presence) {
      const existing = figures.get(presence.id);
      if (existing) {
        const velocity = existing.velocity;
        Object.assign(existing, presence);
        existing.velocity = velocity;
        return;
      }
      const entry: PublishedPresence = { ...presence, velocity: [0, 0, 0] };
      figures.set(presence.id, entry);
      const slot = freeSlots.pop() ?? slots.length;
      slots[slot] = entry;
      slotOf.set(presence.id, slot);
      list = [...figures.values()];
    },
    remove(id) {
      const slot = slotOf.get(id);
      if (slot === undefined) return;
      figures.delete(id);
      slotOf.delete(id);
      slots[slot] = undefined;
      retired.push(slot);
      retiredId[slot] = id;
      list = [...figures.values()];
    },
    get: (id) => figures.get(id),
    all: () => list,
    tick(seconds) {
      const dt = lastTick === null ? 0 : seconds - lastTick;
      lastTick = seconds;
      for (let s = 0; s < slots.length; s++) {
        const f = slots[s];
        if (!f) continue;
        const prev = before[s];
        if (prev && dt > 0) {
          f.velocity[0] = (f.position[0] - prev[0]) / dt;
          f.velocity[1] = (f.position[1] - prev[1]) / dt;
          f.velocity[2] = (f.position[2] - prev[2]) / dt;
        } else f.velocity.fill(0);
        if (prev) {
          prev[0] = f.position[0];
          prev[1] = f.position[1];
          prev[2] = f.position[2];
        } else before[s] = [f.position[0], f.position[1], f.position[2]];
      }
      if (proximity.size > 0)
        for (const sub of proximity) {
          // A pair whose figure was removed has parted (before any newcomer pairs form).
          if (retired.length > 0)
            for (const key of sub.near) {
              const low = Math.floor(key / SLOT_STRIDE);
              const high = key % SLOT_STRIDE;
              if (retired.includes(low) || retired.includes(high)) {
                sub.near.delete(key);
                sub.listener({
                  type: "leave",
                  ids: pairIds(low, high),
                  distance: Number.POSITIVE_INFINITY,
                });
              }
            }
          for (let i = 0; i < slots.length; i++) {
            const a = slots[i];
            if (!a) continue;
            for (let j = i + 1; j < slots.length; j++) {
              const b = slots[j];
              if (!b) continue;
              const key = i * SLOT_STRIDE + j;
              const d = groundDistance(a, b);
              if (!sub.near.has(key) && d <= sub.radius) {
                sub.near.add(key);
                sub.listener({ type: "enter", ids: pairIds(i, j), distance: d });
              } else if (sub.near.has(key) && d > sub.radius * HYSTERESIS) {
                sub.near.delete(key);
                sub.listener({ type: "leave", ids: pairIds(i, j), distance: d });
              }
            }
          }
        }
      // Retired slots are free again once every subscriber has heard of them.
      for (const s of retired) {
        before[s] = undefined;
        retiredId[s] = "";
        freeSlots.push(s);
      }
      retired.length = 0;
    },
    onProximity(radius, listener) {
      const sub = { radius, listener, near: new Set<number>() };
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

/**
 * One contact shadow on the ground: a soft disc at (x, z), cast by a figure
 * standing at height `y`. Sampling pools contacts on one horizontal plane;
 * `groundOcclusion`'s `floorY` keeps off-plane ones out.
 */
export interface ContactPoint {
  x: number;
  y: number;
  z: number;
  radius: number;
  strength: number;
}

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** A figure this close to the floor plane counts as standing on it, metres. */
const FLOOR_TOLERANCE = 0.02;

/**
 * Contact shadows for every figure's footprint. Sample them with
 * `sampleGroundOcclusion`, which pools them with `max`, so figures walking
 * together share one shadow that separates as they part, and overlap never
 * darkens twice.
 *
 * `floorY` is the height of the floor the shadows fall on. A figure standing
 * on it casts at full strength; one raised above (or sunk below) it by more
 * than 2 cm casts less, fading to nothing `reach` metres (default 0.3) off the
 * floor, so a figure on a platform does not shadow the ground below it.
 * Without `floorY` every figure casts.
 *
 * Pass the array a previous call returned as `into` to reuse its contacts:
 * nothing is allocated once it has grown to fit.
 */
export function groundOcclusion(
  presences: readonly FigurePresence[],
  options: { strength?: number; spread?: number; floorY?: number; reach?: number } = {},
  into: ContactPoint[] = [],
): ContactPoint[] {
  const strength = options.strength ?? 0.6;
  const spread = options.spread ?? 2.5;
  const reach = options.reach ?? 0.3;
  let n = 0;
  for (let i = 0; i < presences.length; i++) {
    const p = presences[i] as FigurePresence;
    const off = options.floorY === undefined ? 0 : Math.abs(p.position[1] - options.floorY);
    const k = off <= FLOOR_TOLERANCE ? 1 : 1 - smoothstep(FLOOR_TOLERANCE, reach, off);
    if (k <= 0) continue;
    for (let f = 0; f < p.footprint.points.length; f++) {
      const point = p.footprint.points[f] as [number, number];
      let c = into[n];
      if (!c) {
        c = { x: 0, y: 0, z: 0, radius: 0, strength: 0 };
        into[n] = c;
      }
      c.x = point[0];
      c.y = p.position[1];
      c.z = point[1];
      c.radius = p.footprint.radius * spread;
      c.strength = strength * k;
      n++;
    }
  }
  into.length = n;
  return into;
}

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
