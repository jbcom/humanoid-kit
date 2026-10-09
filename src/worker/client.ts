/**
 * Main-thread handle to the evaluation worker.
 *
 * Evaluations are latest-wins per key: each caller (one `<Humanoid>`, say)
 * passes its own key and has at most one evaluation in the worker and one
 * waiting. A newer request for the key replaces the waiting one, so dragging a
 * slider never builds a backlog, and keys never wait on each other: a figure
 * whose recipe needs target files that are still loading holds up no other.
 */
import type { LoadOptions } from "../format/assetFormat.ts";
import type {
  AdultSurfaceTopology,
  Evaluation,
  GarmentTopology,
  HairTopology,
  ModelOptions,
} from "../model/humanoidModel.ts";
import type { Recipe } from "../recipe/recipe.ts";
import type { LayerFieldsUpdate } from "../surface/layers.ts";
import type { HairInfo, PickMap, ReadyInfo, WorkerRequest, WorkerResponse } from "./protocol.ts";

export type { HairInfo, PickMap, ReadyInfo };

export class HumanoidWorkerError extends Error {
  override name = "HumanoidWorkerError";
}

interface Job {
  recipe: Recipe;
  signals: Readonly<Record<string, number>>;
  haveOutfit: string | null;
  resolve: (e: Evaluation) => void;
  reject: (e: Error) => void;
}

const abortError = () => {
  const e = new Error("superseded by a newer evaluation");
  e.name = "AbortError";
  return e;
};

export class HumanoidWorkerClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void }
  >();
  private disposed = false;
  /** The waiting evaluation of each key; Map iteration order is first-queued order. */
  private readonly queue = new Map<string, Job>();
  /** Keys with an evaluation in the worker. */
  private readonly inFlight = new Set<string>();
  /** Resolves when the worker can evaluate the first figure (`LoadOptions.firstFigureAge`). */
  readonly ready: Promise<ReadyInfo>;
  /**
   * Resolves when every target file has loaded, or rejects with the error that
   * stopped one (figures whose targets did arrive keep working).
   */
  readonly complete: Promise<void>;

  constructor(load: LoadOptions, model: ModelOptions = {}, worker?: Worker) {
    // A runtime URL, not an import: it names the built worker module next to this file in dist/.
    // Consumers bundling from source, like the playground, pass their own `worker`.
    this.worker = worker ?? new Worker(new URL("./index.js", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.type === "error") {
        const err = new HumanoidWorkerError(e.data.message);
        err.name = e.data.name;
        p.reject(err);
      } else p.resolve(e.data);
    };
    this.worker.onerror = (e) =>
      this.failAll(new HumanoidWorkerError(e.message || "worker failed"));
    this.ready = this.request({ type: "init", id: 0, load, model }).then((r) => {
      if (r.type !== "ready") throw new HumanoidWorkerError(`unexpected ${r.type}`);
      const { type: _type, id: _id, ...info } = r;
      return info;
    });
    // Rejections reach every caller that awaits `ready`; this only marks the
    // promise observed so a client disposed during init is not reported twice.
    this.ready.catch(() => undefined);
    this.complete = this.ready.then(async () => {
      const r = await this.request({ type: "complete", id: 0 });
      if (r.type !== "completed") throw new HumanoidWorkerError(`unexpected ${r.type}`);
    });
    this.complete.catch(() => undefined);
  }

  private readonly hairTopologies = new Map<string, HairTopology>();

  /**
   * A hair style's static render data, once an evaluation that wears it has
   * resolved: the worker sends it with the first and the client keeps it, so
   * `Evaluation.hair` is rendered with `hairTopology(evaluation.hair.id)`.
   */
  hairTopology(id: string): HairTopology | undefined {
    return this.hairTopologies.get(id);
  }

  private pickMapRequest: Promise<PickMap> | null = null;

  /**
   * Which controls shape each rendered vertex (see `buildFeatureMap`), for
   * opening the controls of a tapped part. Built by the worker on the first
   * call, once the target files it is derived from have loaded; later calls
   * share that answer.
   */
  pickMap(): Promise<PickMap> {
    this.pickMapRequest ??= this.ready.then(async () => {
      const r = await this.request({ type: "pickMap", id: 0 });
      if (r.type !== "pickMap") throw new HumanoidWorkerError(`unexpected ${r.type}`);
      const { type: _type, id: _id, ...map } = r;
      return map;
    });
    return this.pickMapRequest;
  }

  private posedOcclusionRequest: Promise<Float32Array[] | null> | null = null;

  /**
   * The pose-following occlusion of a worn set the pack did not bake
   * (`HumanoidModel.bakePosedOcclusion`): per worn attachment, values for
   * `setOcclusionAttributes`, or null when `ready`'s topology already
   * follows the pose. The worker bakes it between evaluations, once; later
   * calls share that answer.
   */
  posedOcclusion(): Promise<Float32Array[] | null> {
    this.posedOcclusionRequest ??= this.ready.then(async () => {
      const r = await this.request({ type: "posedOcclusion", id: 0 });
      if (r.type !== "posedOcclusion") throw new HumanoidWorkerError(`unexpected ${r.type}`);
      return r.attachments;
    });
    return this.posedOcclusionRequest;
  }

  private adultLayersRequest: Promise<LayerFieldsUpdate | null> | null = null;

  /**
   * The adult anatomy layers' fields per render vertex
   * (`HumanoidModel.adultLayerFields`), for `refreshLayerAtlas`: they arrive
   * once the adult pack's last load stage has, so the figure draws without them
   * first. Null without an adult pack. Built by the worker on the first call;
   * later calls share that answer, so treat it as read-only. Rejects with the
   * error that stopped the adult stage.
   */
  adultLayers(): Promise<LayerFieldsUpdate | null> {
    this.adultLayersRequest ??= this.ready.then(async () => {
      const r = await this.request({ type: "adultLayers", id: 0 });
      if (r.type !== "adultLayers") throw new HumanoidWorkerError(`unexpected ${r.type}`);
      return r.update;
    });
    return this.adultLayersRequest;
  }

  private adultSurfaceRequest: Promise<AdultSurfaceTopology | null> | null = null;

  /**
   * The surface an evaluation of a figure aged 18 or over is for
   * (`Evaluation.surface === "adult"`): the base body with the adult pack's finer
   * geometry round the pelvis, its index, UVs, skin weights and `uvScale` for
   * building the mesh. Null without an adult pack that refines the body. It is
   * not in `ready`'s topology, which is every figure's. Built by the worker on
   * the first call; later calls share that answer, so treat it as read-only.
   */
  adultSurface(): Promise<AdultSurfaceTopology | null> {
    this.adultSurfaceRequest ??= this.ready.then(async () => {
      const r = await this.request({ type: "adultSurface", id: 0 });
      if (r.type !== "adultSurface") throw new HumanoidWorkerError(`unexpected ${r.type}`);
      return r.topology;
    });
    return this.adultSurfaceRequest;
  }

  private request(msg: WorkerRequest): Promise<WorkerResponse> {
    if (this.disposed) return Promise.reject(new HumanoidWorkerError("disposed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ ...msg, id });
      } catch (e) {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new HumanoidWorkerError(String(e)));
      }
    });
  }

  /**
   * Evaluates a recipe, in a skin state when `signals` drive state morphs
   * (`STATE_MORPHS`). `key` identifies the caller; a waiting request for the
   * same key is superseded and rejects with an `AbortError`.
   */
  evaluate(
    recipe: Recipe,
    key = "default",
    signals: Readonly<Record<string, number>> = {},
    haveOutfit: string | null = null,
  ): Promise<Evaluation> {
    if (this.disposed) return Promise.reject(new HumanoidWorkerError("disposed"));
    return new Promise((resolve, reject) => {
      this.queue.get(key)?.reject(abortError());
      // Map.set on an existing key keeps its position, so a superseding
      // request keeps its caller's place in line.
      this.queue.set(key, { recipe, signals, haveOutfit, resolve, reject });
      void this.pump();
    });
  }

  private readonly garmentRequests = new Map<string, Promise<GarmentTopology>>();

  /**
   * A garment's static render data (`HumanoidModel.garmentTopology`), fetched
   * from the worker once however many figures wear it. A failed request is not
   * kept, so asking again tries again.
   */
  garment(id: string): Promise<GarmentTopology> {
    let request = this.garmentRequests.get(id);
    if (!request) {
      request = this.ready.then(async () => {
        const r = await this.request({ type: "garment", id: 0, garment: id });
        if (r.type !== "garment") throw new HumanoidWorkerError(`unexpected ${r.type}`);
        return r.topology;
      });
      this.garmentRequests.set(id, request);
      request.catch(() => this.garmentRequests.delete(id));
    }
    return request;
  }

  /** Sends the waiting evaluation of every key that has none in the worker. */
  private async pump(): Promise<void> {
    try {
      await this.ready;
    } catch (e) {
      this.failQueued(e instanceof Error ? e : new HumanoidWorkerError(String(e)));
      return;
    }
    if (this.disposed) return;
    for (const [key, job] of [...this.queue]) {
      if (this.inFlight.has(key)) continue;
      this.queue.delete(key);
      this.inFlight.add(key);
      void this.run(key, job);
    }
  }

  private async run(key: string, job: Job): Promise<void> {
    try {
      const r = await this.request({
        type: "evaluate",
        id: 0,
        recipe: job.recipe,
        signals: job.signals,
        haveOutfit: job.haveOutfit,
      });
      if (r.type !== "evaluated") throw new HumanoidWorkerError(`unexpected ${r.type}`);
      // Kept before the evaluation resolves, so whoever receives it can look the style up.
      if (r.hairTopology) this.hairTopologies.set(r.hairTopology.id, r.hairTopology);
      job.resolve(r.evaluation);
    } catch (e) {
      job.reject(e instanceof Error ? e : new HumanoidWorkerError(String(e)));
    } finally {
      this.inFlight.delete(key);
      if (this.queue.has(key)) void this.pump();
    }
  }

  private failQueued(err: Error): void {
    for (const job of this.queue.values()) job.reject(err);
    this.queue.clear();
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.failQueued(err);
  }

  /** Terminates the worker; every waiting and in-flight evaluation rejects. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.failAll(new HumanoidWorkerError("disposed"));
  }
}
