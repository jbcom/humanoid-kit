/**
 * A figure's affordances as it is drawn (docs/ARCHITECTURE.md, "Affordances:
 * the registry", "The public API"): the handle `useHumanoidAffordances`
 * returns and `<Humanoid affordances>` feeds.
 *
 * Nothing is stored but state. A frame is worked out when it is read, on the
 * figure exactly as the GPU draws it: its landmarks' render vertices skinned on
 * the main thread from the evaluation the figure was drawn from, the topology's
 * skin weights, the pose its bones were last given, the hip fold at the share
 * faded in, then carried to world space by the lifted group's `matrixWorld`.
 * The figure says how it is drawn through a `LiveFigure`; this file knows
 * nothing of React.
 */
import { Matrix4, type Object3D, Vector3 } from "three";
import {
  type FrameOut,
  frameOut,
  LANDMARK_IDS,
  type LandmarkAnchors,
  type LandmarkId,
  landmarkFrameInto,
  landmarkUps,
  type PosedSkeleton,
  type SkinRenderVertex,
  type Vec3,
} from "../foundation/landmarks.ts";
import { isAdult } from "../recipe/agePolicy.ts";
import type { Recipe } from "../recipe/recipe.ts";
import { ChannelClip, CLIP_CHANNELS } from "../render/channelClip.ts";
import { type SkinFold, type SkinPose, skinNormalAt, skinPositionAt } from "../rig/dual.ts";
import type { SurfaceAnchors } from "../worker/protocol.ts";
import { type Channel, type ChannelPlace, placeIn } from "./channel.ts";
import { affordanceChannel, affordanceFrameInto, type LandmarkReader } from "./frames.ts";
import {
  type Affordance,
  affordances,
  CORE_AFFORDANCES,
  type FigureAffordances,
  NO_AFFORDANCES,
} from "./registry.ts";
import { type AffordanceChange, type AffordanceState, AffordanceStates } from "./state.ts";

/**
 * How a figure is drawn, as the handle reads it: what `<Humanoid>` draws from,
 * and the pose its bones were last given. Every read is of the live values.
 */
export interface LiveFigure {
  /** Which body surface is drawn. */
  readonly surface: "base" | "adult";
  /** The evaluation's render vertices at rest, and their normals: what the GPU skins. */
  readonly rest: Float32Array;
  readonly restNormals: Float32Array;
  /** That surface's skin weights. */
  readonly skinIndex: Uint8Array | Uint16Array;
  readonly skinWeight: Float32Array;
  /** The pose as the GPU skins by it (`DualBones.pose`, or `linearPose` for a custom material); null before the first. */
  pose(): SkinPose | null;
  /** The hip fold on this surface at the share showing (`DualBones.skinFold`), or null. */
  fold(): SkinFold | null;
  /** The posed skeleton, for the joints' landmarks; null before the first pose. */
  skeleton(): PosedSkeleton | null;
  /** The group the figure's meshes are drawn in, whose `matrixWorld` is its space's; null for world space itself. */
  readonly world: Object3D | null;
}

const LANDMARK_SET: ReadonlySet<string> = new Set(LANDMARK_IDS);

/** Where a frame is given: in the figure's own space (the lifted group's), or in world space. */
export type AffordanceSpace = "figure" | "world";

/**
 * A figure's own affordances, their state and their frames on the figure as
 * drawn. Made by `useHumanoidAffordances` and fed by `<Humanoid affordances>`;
 * the figure keeps it current, and every read is of the frame being drawn.
 */
export class HumanoidAffordances {
  private readonly registry: readonly Affordance[];
  private recipe: Recipe | null = null;
  /** Whether the recipe last given is an adult's; null before the first. */
  private adult: boolean | null = null;
  private list: FigureAffordances = NO_AFFORDANCES;
  private byId = new Map<string, Affordance>();
  private states = new AffordanceStates(NO_AFFORDANCES);
  private figure: LiveFigure | null = null;
  private anchors: SurfaceAnchors | null = null;
  /** The up neighbours, worked out once per figure drawn. */
  private ups: { figure: LiveFigure; anchors: LandmarkAnchors; ups: Int32Array } | null = null;
  private clipped: ChannelClip | null = null;
  private readonly listeners = new Set<() => void>();
  /** What a read works from, set by `prepare` (held in place, so a read allocates nothing). */
  private readonly now: {
    figure: LiveFigure | null;
    anchors: LandmarkAnchors | null;
    ups: Int32Array;
    pose: SkinPose | null;
    fold: SkinFold | null;
    skeleton: PosedSkeleton | null;
  } = {
    figure: null,
    anchors: null,
    ups: new Int32Array(0),
    pose: null,
    fold: null,
    skeleton: null,
  };
  private readonly point = new Vector3();
  private readonly inverse = new Matrix4();
  private readonly scale = new Vector3();
  /**
   * Changes whenever the mouth's opening may have (it is set, or the figure's
   * list is rebuilt): the figure then lays the opening over its jaw (`jawOpening`).
   */
  jawVersion = 0;
  /** Changes whenever the figure drawn changes (`attach`), for whatever is placed on it. */
  version = 0;

  /** `registry`: the affordances figures may have (the core's, and a pack's once it declares some). */
  constructor(registry: readonly Affordance[] = CORE_AFFORDANCES) {
    this.registry = registry;
  }

  /** The figure's own affordances (`affordances(recipe)`): none until the figure has a recipe. */
  get own(): FigureAffordances {
    return this.list;
  }

  /**
   * The recipe the figure draws. The figure's own list depends on its age
   * alone: a recipe that crosses 18 rebuilds it, and every state with it, so
   * nothing of the adult anatomy's outlives the figure's adulthood.
   */
  setRecipe(recipe: Recipe): void {
    if (recipe === this.recipe) return;
    this.recipe = recipe;
    const adult = isAdult(recipe);
    if (adult === this.adult) return;
    this.adult = adult;
    this.list = affordances(recipe, this.registry);
    this.byId = new Map(this.list.map((a) => [a.id, a]));
    this.states = new AffordanceStates(this.list);
    this.jawVersion++;
  }

  /** Where the landmarks are held on the body surfaces (`HumanoidWorkerClient.landmarkAnchors`). */
  setAnchors(anchors: SurfaceAnchors | null): void {
    this.anchors = anchors;
    this.ups = null;
  }

  /** The figure as drawn, or null when none is. */
  attach(figure: LiveFigure | null): void {
    this.figure = figure;
    this.ups = null;
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Calls `listener` whenever the figure drawn changes; returns the call that stops it. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The group the figure's meshes are drawn in, or null before it is drawn. */
  get lifted(): Object3D | null {
    return this.figure?.world ?? null;
  }

  /** Whether the figure has the affordance (it is in `own`). */
  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** A copy of the affordance's state; throws `RangeError` for one the figure does not have. */
  get(id: string): AffordanceState {
    return this.states.get(id);
  }

  /**
   * Merges `change` into the affordance's state, checked (`changeState`), and
   * returns a copy; throws `RangeError` for one the figure does not have. The
   * mouth's opening opens the drawn jaw on the next frame.
   */
  set(id: string, change: AffordanceChange): AffordanceState {
    const next = this.states.set(id, change);
    if (this.byId.get(id)?.channel === "oral" && "opening" in change) this.jawVersion++;
    return next;
  }

  /** How open the mouth is, 0 to 1: the most any of the figure's oral apertures is. */
  jawOpening(): number {
    let open = 0;
    for (const a of this.list) {
      if (a.channel !== "oral") continue;
      const s = this.states.get(a.id);
      if (s.kind === "aperture") open = Math.max(open, s.opening);
    }
    return open;
  }

  /**
   * The affordance's frame on the figure as drawn now, in the figure's own
   * space (the lifted group's) or in world space, written into `out` (one is
   * made when none is given; given one, a read allocates nothing). Null until
   * the figure is drawn and its anchors have arrived; throws `RangeError` for
   * an affordance the figure does not have.
   */
  frame(
    id: string,
    space: AffordanceSpace = "figure",
    out: FrameOut = frameOut(),
  ): FrameOut | null {
    const a = this.affordance(id);
    if (!this.prepare()) return null;
    affordanceFrameInto(a, this.read, out);
    if (space === "world") this.toWorld(out);
    return out;
  }

  /**
   * Where render vertex `v` of the body surface drawn is now (a tap's
   * `HumanoidPick.vertex` on the body), in the figure's own space or in world
   * space, written into `out`. Null until the figure is drawn and its anchors
   * have arrived.
   */
  vertex(
    v: number,
    space: AffordanceSpace = "figure",
    out: [number, number, number] = [0, 0, 0],
  ): [number, number, number] | null {
    if (!this.prepare()) return null;
    const count = (this.now.figure as LiveFigure).rest.length / 3;
    if (!(Number.isInteger(v) && v >= 0 && v < count))
      throw new RangeError(`the figure's body has no vertex ${v}`);
    const p = this.vertexScratch;
    this.skin(v, p, null);
    out[0] = p[0] as number;
    out[1] = p[1] as number;
    out[2] = p[2] as number;
    const w = space === "world" ? this.figure?.world : null;
    if (w) {
      w.updateWorldMatrix(true, false);
      const q = this.point.set(out[0], out[1], out[2]).applyMatrix4(w.matrixWorld);
      out[0] = q.x;
      out[1] = q.y;
      out[2] = q.z;
    }
    return out;
  }

  private readonly vertexScratch = new Float32Array(3);

  /**
   * A landmark's frame on the figure as drawn now (`LANDMARK_IDS`), as `frame`
   * gives an affordance's: what a garment or a prop is placed by where no
   * affordance is. Null until the figure is drawn and its anchors have arrived.
   */
  landmark(
    id: LandmarkId,
    space: AffordanceSpace = "figure",
    out: FrameOut = frameOut(),
  ): FrameOut | null {
    if (!LANDMARK_SET.has(id)) throw new RangeError(`there is no landmark ${id}`);
    if (!this.prepare()) return null;
    this.read(id, out);
    if (space === "world") this.toWorld(out);
    return out;
  }

  /**
   * An aperture's channel on the figure as drawn now, in the figure's own
   * space, opened as its state says; null for an affordance with none, or
   * before the figure is drawn. Throws `RangeError` for one it does not have.
   */
  channel(id: string): Channel | null {
    const a = this.affordance(id);
    if (!a.channel || !this.prepare()) return null;
    const s = this.states.get(id);
    return affordanceChannel(a, this.read, s.kind === "aperture" ? s.opening : 0);
  }

  /**
   * Where a world-space point is against an aperture's channel: how far in
   * (world metres) and whether it is inside. Null where `channel` is.
   */
  place(id: string, worldPoint: Vec3): ChannelPlace | null {
    const c = this.channel(id);
    if (!c) return null;
    const p = this.point.set(worldPoint[0], worldPoint[1], worldPoint[2]);
    const w = this.figure?.world;
    let scale = 1;
    if (w) {
      w.updateWorldMatrix(true, false);
      p.applyMatrix4(this.inverse.copy(w.matrixWorld).invert());
      scale = this.scale.setFromMatrixScale(w.matrixWorld).x;
    }
    const place = placeIn(c, [p.x, p.y, p.z]);
    return { depth: place.depth * scale, inside: place.inside };
  }

  /**
   * A clip of the figure's apertures' channels (`ChannelClip`) that keeps
   * itself current: the figure sets it after posing each frame (`refreshClip`)
   * and it follows the lifted group, so `clipMaterial(material, clip)` is all
   * an object entering the figure needs. Made on first use.
   */
  get clip(): ChannelClip {
    if (!this.clipped) {
      this.clipped = new ChannelClip();
      this.refreshClip();
    }
    return this.clipped;
  }

  /** Sets the clip, if there is one, to the figure's channels as drawn now. */
  refreshClip(): void {
    const clip = this.clipped;
    if (!clip) return;
    clip.follow(this.figure?.world ?? null);
    const channels: Channel[] = [];
    for (const a of this.list) {
      if (!a.channel || channels.length === CLIP_CHANNELS) continue;
      const c = this.channel(a.id);
      if (c) channels.push(c);
    }
    clip.set(channels);
  }

  private affordance(id: string): Affordance {
    const a = this.byId.get(id);
    if (!a) throw new RangeError(`the figure has no affordance ${id}`);
    return a;
  }

  /** Gathers what a read works from; false until the figure is drawn and its anchors are here. */
  private prepare(): boolean {
    const figure = this.figure;
    const anchors = figure && this.anchors?.[figure.surface];
    const pose = figure?.pose();
    const skeleton = figure?.skeleton();
    const now = this.now;
    if (!figure || !anchors || !pose || !skeleton) {
      now.figure = null;
      return false;
    }
    if (!this.ups || this.ups.figure !== figure || this.ups.anchors !== anchors)
      this.ups = { figure, anchors, ups: landmarkUps(anchors, figure.rest, figure.restNormals) };
    now.figure = figure;
    now.anchors = anchors;
    now.ups = this.ups.ups;
    now.pose = pose;
    now.fold = figure.fold();
    now.skeleton = skeleton;
    return true;
  }

  /** A render vertex skinned as the GPU skins it. */
  private readonly skin: SkinRenderVertex = (v, position, normal) => {
    const { figure: f, pose, fold } = this.now;
    if (!f || !pose) throw new Error("affordances: a vertex skinned outside a read");
    const r = f.rest;
    skinPositionAt(
      pose,
      f.skinIndex,
      f.skinWeight,
      v,
      r[v * 3] as number,
      r[v * 3 + 1] as number,
      r[v * 3 + 2] as number,
      position,
      0,
      fold,
    );
    if (!normal) return;
    const n = f.restNormals;
    skinNormalAt(
      pose,
      f.skinIndex,
      f.skinWeight,
      v,
      n[v * 3] as number,
      n[v * 3 + 1] as number,
      n[v * 3 + 2] as number,
      normal,
      0,
      fold,
    );
  };

  /** A landmark's frame on the figure as drawn. */
  private readonly read: LandmarkReader = (id, out) => {
    const { anchors, ups, skeleton } = this.now;
    if (!anchors || !skeleton) throw new Error("affordances: a landmark read outside a read");
    return landmarkFrameInto(id, anchors, ups, this.skin, skeleton, out);
  };

  /** Carries a frame in the figure's space to world space. */
  private toWorld(out: FrameOut): void {
    const w = this.figure?.world;
    if (!w) return;
    w.updateWorldMatrix(true, false);
    const m = w.matrixWorld;
    const v = this.point;
    v.set(out.position[0], out.position[1], out.position[2]).applyMatrix4(m);
    out.position[0] = v.x;
    out.position[1] = v.y;
    out.position[2] = v.z;
    this.turn(out.normal, m);
    this.turn(out.tangent, m);
    this.turn(out.bitangent, m);
  }

  /** Turns direction `d` by `m`'s rotation, in place (its scale divided out). */
  private turn(d: [number, number, number], m: Matrix4): void {
    const v = this.point.set(d[0], d[1], d[2]).transformDirection(m);
    d[0] = v.x;
    d[1] = v.y;
    d[2] = v.z;
  }
}
