/**
 * Animation frames and the channel that carries them (docs/INTERACTION-SESSION.md,
 * "Animation frames"): what a figure playing a clip publishes each frame, and how
 * a consumer receives it without React, a DOM or a renderer.
 *
 * A producer binds a figure id and publishes the one frame object it reuses; a
 * consumer observes an id. Binding an id again supersedes the producer before it,
 * whose later frames are dropped, and every binding raises `generation`, so no
 * stale frame reaches a consumer after a client changes. Nothing is allocated per
 * frame once a figure is publishing.
 */

/** A point on a sole that a grounded clip stands on. */
export type AnimationContactPoint = "heel" | "ballInner" | "ballOuter";

/** The six sole contacts in frame order: each point, left foot before right. */
export const ANIMATION_CONTACTS: readonly {
  side: "left" | "right";
  point: AnimationContactPoint;
}[] = (["heel", "ballInner", "ballOuter"] as const).flatMap((point) =>
  (["left", "right"] as const).map((side) => ({ side, point })),
);

/** One sole contact of a frame, figure-local metres after the ground lift. */
export interface HumanoidAnimationContact {
  /** Left or right foot. */
  side: "left" | "right";
  /** The sole point: ankle/heel, inner ball, or outer ball. */
  point: AnimationContactPoint;
  /** Figure-local point after ground lift, before root carry, heading or any parent transform. */
  position: [number, number, number];
  /** Whether this point is the real FootLock owner; ownership can fade during rollover/release. */
  owned: boolean;
  /** FootLock's continuous hold for this owner, from 0 (released) to 1 (fully planted); 0 when not owned. */
  hold: number;
}

/**
 * A completed clip frame: metres and seconds. The producer reuses this object every
 * frame, so it is valid only during the observer's call; copy what you keep
 * (`copyAnimationFrame`).
 */
export interface HumanoidAnimationFrame {
  /** The figure's id: its presence id when it publishes into a registry. */
  figure: string;
  /** Rises on every binding and rebinding of the figure (a new client, a new evaluation); never falls. */
  generation: number;
  /** The clip playing and the seconds into it. */
  clip: string;
  time: number;
  /** Cumulative figure-local root carry, x then forward z. */
  root: [number, number];
  /** This frame's root carry, before any heading or parent transform. */
  delta: [number, number];
  /** Metres the figure was lifted onto the ground this frame. */
  lift: number;
  /** The six sole contacts, in `ANIMATION_CONTACTS` order. */
  contacts: HumanoidAnimationContact[];
  /** Figure-local to world, a 4 × 4 column-major matrix (three.js `Matrix4.elements`), after this frame's carry. */
  toWorld: number[];
}

/** A frame with every field at rest, the identity placement and the six contacts allocated. */
export function createAnimationFrame(figure = ""): HumanoidAnimationFrame {
  return {
    figure,
    generation: 0,
    clip: "",
    time: 0,
    root: [0, 0],
    delta: [0, 0],
    lift: 0,
    contacts: ANIMATION_CONTACTS.map(({ side, point }) => ({
      side,
      point,
      position: [0, 0, 0],
      owned: false,
      hold: 0,
    })),
    toWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  };
}

/** A deep copy of `frame` into `out` (allocated when absent): what a consumer keeps beyond its call. */
export function copyAnimationFrame(
  frame: Readonly<HumanoidAnimationFrame>,
  out: HumanoidAnimationFrame = createAnimationFrame(),
): HumanoidAnimationFrame {
  out.figure = frame.figure;
  out.generation = frame.generation;
  out.clip = frame.clip;
  out.time = frame.time;
  out.root[0] = frame.root[0];
  out.root[1] = frame.root[1];
  out.delta[0] = frame.delta[0];
  out.delta[1] = frame.delta[1];
  out.lift = frame.lift;
  for (let k = 0; k < out.contacts.length; k++) {
    const from = frame.contacts[k] as HumanoidAnimationContact;
    const to = out.contacts[k] as HumanoidAnimationContact;
    to.side = from.side;
    to.point = from.point;
    to.position[0] = from.position[0];
    to.position[1] = from.position[1];
    to.position[2] = from.position[2];
    to.owned = from.owned;
    to.hold = from.hold;
  }
  for (let k = 0; k < 16; k++) out.toWorld[k] = frame.toWorld[k] as number;
  return out;
}

/**
 * Places a headless producer's frame: the figure's ground point in world space and
 * the way it faces (its ground component is used; a figure facing straight up or
 * down keeps +z), as `<Humanoid>` takes them from its group.
 */
export function setFramePlacement(
  frame: HumanoidAnimationFrame,
  position: readonly [number, number, number],
  facing: readonly [number, number, number],
): void {
  const len = Math.hypot(facing[0], facing[2]);
  const s = len > 1e-9 ? facing[0] / len : 0;
  const c = len > 1e-9 ? facing[2] / len : 1;
  const m = frame.toWorld;
  // A turn about +y that takes +z to the facing, then the translation.
  m[0] = c;
  m[1] = 0;
  m[2] = -s;
  m[3] = 0;
  m[4] = 0;
  m[5] = 1;
  m[6] = 0;
  m[7] = 0;
  m[8] = s;
  m[9] = 0;
  m[10] = c;
  m[11] = 0;
  m[12] = position[0];
  m[13] = position[1];
  m[14] = position[2];
  m[15] = 1;
}

/** Contact `index`'s position in world space, through the frame's `toWorld`, into `out`. */
export function frameContactWorld(
  frame: Readonly<HumanoidAnimationFrame>,
  index: number,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const contact = frame.contacts[index];
  if (!contact) throw new RangeError(`a frame has no contact ${index}`);
  const [x, y, z] = contact.position;
  const m = frame.toWorld as readonly number[];
  const at = (k: number) => m[k] as number;
  const w = at(3) * x + at(7) * y + at(11) * z + at(15);
  out[0] = (at(0) * x + at(4) * y + at(8) * z + at(12)) / w;
  out[1] = (at(1) * x + at(5) * y + at(9) * z + at(13)) / w;
  out[2] = (at(2) * x + at(6) * y + at(10) * z + at(14)) / w;
  return out;
}

/** Receives a figure's completed frame; the object is reused, so copy what you keep. */
export type FrameObserver = (frame: Readonly<HumanoidAnimationFrame>) => void;

/** Why an observed figure's producer stopped: it let go, or another producer bound the id. */
export type FrameReleaseReason = "released" | "superseded";

export type FrameReleaseObserver = (reason: FrameReleaseReason, figure: string) => void;

/** A producer's hold on a figure id: the only way frames for that id are published. */
export interface FrameBinding {
  readonly figure: string;
  /** False once released or superseded: `publish` then drops every frame. */
  readonly live: boolean;
  /** The generation this binding stamps on its frames. */
  readonly generation: number;
  /**
   * Stamps `frame` with the figure and generation and delivers it to the figure's
   * observers. Returns false, delivering nothing, once the binding is not live.
   * Every observer receives the frame; the first exception any of them threw is
   * then rethrown.
   */
  publish(frame: HumanoidAnimationFrame): boolean;
  /** Raises the generation (the figure was evaluated again); returns the new one, or the old once not live. */
  rebind(): number;
  /** Stops publishing and tells the observers `released`; idempotent. */
  release(): void;
}

/** The channel: figure ids to their producer and observers. */
export interface AnimationFrames {
  /**
   * Calls `onFrame` with each frame published for `figure`, and `onRelease` when its
   * producer stops. Observing outlives producers: a figure that is bound again is
   * delivered again. Returns the unsubscribe function, which is idempotent.
   */
  observe(figure: string, onFrame: FrameObserver, onRelease?: FrameReleaseObserver): () => void;
  /** Binds a producer to `figure`, superseding any producer bound to it. */
  bind(figure: string): FrameBinding;
}

interface Observer {
  onFrame: FrameObserver;
  onRelease: FrameReleaseObserver | undefined;
  /** False once unsubscribed: a delivery already under way skips it. */
  active: boolean;
}

/** A binding's own state, which the channel can end when another producer binds its figure. */
interface Producer {
  live: boolean;
  generation: number;
}

interface Entry {
  producer: Producer | null;
  /** Replaced, never mutated, so a delivery walks the observers it began with. */
  observers: readonly Observer[];
}

export function createAnimationFrames(): AnimationFrames {
  const entries = new Map<string, Entry>();
  /** One clock for every figure, so a figure's generation never falls whoever binds it. */
  let generations = 0;

  const entryOf = (figure: string): Entry => {
    let e = entries.get(figure);
    if (!e) {
      e = { producer: null, observers: [] };
      entries.set(figure, e);
    }
    return e;
  };

  /** A figure with neither producer nor observer holds nothing. */
  const prune = (figure: string, e: Entry) => {
    if (!e.producer && e.observers.length === 0) entries.delete(figure);
  };

  /** Calls `each` on every active observer, then rethrows the first exception. */
  const deliver = (observers: readonly Observer[], each: (o: Observer) => void) => {
    let failed = false;
    let error: unknown;
    for (let k = 0; k < observers.length; k++) {
      const o = observers[k] as Observer;
      if (!o.active) continue;
      try {
        each(o);
      } catch (e) {
        if (!failed) {
          failed = true;
          error = e;
        }
      }
    }
    if (failed) throw error;
  };

  const releaseTo = (figure: string, e: Entry, reason: FrameReleaseReason) =>
    deliver(e.observers, (o) => o.onRelease?.(reason, figure));

  return {
    observe(figure, onFrame, onRelease) {
      const e = entryOf(figure);
      const o: Observer = { onFrame, onRelease, active: true };
      e.observers = [...e.observers, o];
      return () => {
        if (!o.active) return;
        o.active = false;
        const current = entries.get(figure);
        if (!current) return;
        current.observers = current.observers.filter((x) => x !== o);
        prune(figure, current);
      };
    },
    bind(figure) {
      const e = entryOf(figure);
      const producer: Producer = { live: true, generation: ++generations };
      const binding: FrameBinding = {
        figure,
        get live() {
          return producer.live;
        },
        get generation() {
          return producer.generation;
        },
        publish(frame) {
          if (!producer.live) return false;
          frame.figure = figure;
          frame.generation = producer.generation;
          // The entry is looked up again: an unobserved, unbound figure was pruned.
          const current = entries.get(figure);
          if (current) deliver(current.observers, (o) => o.onFrame(frame));
          return true;
        },
        rebind() {
          if (producer.live) producer.generation = ++generations;
          return producer.generation;
        },
        release() {
          if (!producer.live) return;
          producer.live = false;
          const current = entries.get(figure);
          if (!current || current.producer !== producer) return;
          current.producer = null;
          prune(figure, current);
          releaseTo(figure, current, "released");
        },
      };
      const previous = e.producer;
      e.producer = producer;
      if (previous) {
        // The old producer is dead before anyone hears of it, so a frame it
        // publishes from inside an observer's call is already dropped.
        previous.live = false;
        releaseTo(figure, e, "superseded");
      }
      return binding;
    },
  };
}
