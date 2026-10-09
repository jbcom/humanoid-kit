/**
 * Main-thread handle to the evaluation worker. Evaluations are latest-wins:
 * while one is running, newer requests replace any queued one, so dragging a
 * slider never builds a backlog.
 */
import type { LoadOptions } from "../format/assetFormat.ts";
import type { Evaluation, ModelOptions, ModelTopology } from "../model/humanoidModel.ts";
import type { Recipe } from "../recipe/recipe.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

export interface ReadyInfo {
  topology: ModelTopology;
  modifierIds: string[];
  adultAnatomyLoaded: boolean;
}

export class HumanoidWorkerError extends Error {
  override name = "HumanoidWorkerError";
}

export class HumanoidWorkerClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void }
  >();
  private running = false;
  private queued: {
    recipe: Recipe;
    resolve: (e: Evaluation) => void;
    reject: (e: Error) => void;
  } | null = null;
  readonly ready: Promise<ReadyInfo>;

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
    this.worker.onerror = (e) => {
      const err = new HumanoidWorkerError(e.message || "worker failed");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
    this.ready = this.request({ type: "init", id: 0, load, model }).then((r) => {
      if (r.type !== "ready") throw new HumanoidWorkerError(`unexpected ${r.type}`);
      return {
        topology: r.topology,
        modifierIds: r.modifierIds,
        adultAnatomyLoaded: r.adultAnatomyLoaded,
      };
    });
    // A client disposed before it is ready rejects `ready`; mark that observed so
    // it is not reported as unhandled. Callers awaiting `ready` still see the error.
    this.ready.catch(() => undefined);
  }

  private request(msg: WorkerRequest): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id });
    });
  }

  /** Evaluates a recipe. A request superseded by a newer one before it starts rejects with an AbortError. */
  evaluate(recipe: Recipe): Promise<Evaluation> {
    return new Promise((resolve, reject) => {
      if (this.queued) {
        const abort = new Error("superseded by a newer evaluation");
        abort.name = "AbortError";
        this.queued.reject(abort);
      }
      this.queued = { recipe, resolve, reject };
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.running || !this.queued) return;
    await this.ready;
    const job = this.queued;
    if (!job || this.running) return;
    this.queued = null;
    this.running = true;
    try {
      const r = await this.request({ type: "evaluate", id: 0, recipe: job.recipe });
      if (r.type !== "evaluated") throw new HumanoidWorkerError(`unexpected ${r.type}`);
      job.resolve(r.evaluation);
    } catch (e) {
      job.reject(e instanceof Error ? e : new Error(String(e)));
    } finally {
      this.running = false;
      void this.pump();
    }
  }

  dispose(): void {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new HumanoidWorkerError("disposed"));
    this.pending.clear();
  }
}
