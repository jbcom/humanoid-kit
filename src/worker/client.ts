/**
 * Main-thread handle to the evaluation worker.
 *
 * Evaluations are latest-wins per key: each caller (one `<Humanoid>`, say)
 * passes its own key, and while a key has an evaluation waiting, a newer
 * request for the same key replaces it, so dragging a slider never builds a
 * backlog while several figures sharing one worker never cancel each other.
 * Waiting keys are served in the order they were first queued, except that an
 * evaluation setting shape modifiers is held back until the modifier targets
 * have loaded, so it never keeps a macro-only figure waiting behind it.
 */
import type { LoadOptions } from "../format/assetFormat.ts";
import type { Evaluation, ModelOptions } from "../model/humanoidModel.ts";
import { type Recipe, recipeSetsModifiers } from "../recipe/recipe.ts";
import type { ReadyInfo, WorkerRequest, WorkerResponse } from "./protocol.ts";

export type { ReadyInfo };

export class HumanoidWorkerError extends Error {
  override name = "HumanoidWorkerError";
}

interface Job {
  recipe: Recipe;
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
  private running = false;
  private disposed = false;
  /** Waiting evaluations by caller key; Map iteration order is first-queued order. */
  private readonly queue = new Map<string, Job>();
  /** Whether the modifier targets have loaded or failed; either way, held jobs may go. */
  private modifierTargetsSettled = false;
  /** Resolves when the worker can evaluate a figure built from macros. */
  readonly ready: Promise<ReadyInfo>;
  /**
   * Resolves when the modifier targets have loaded as well, or rejects with
   * the error that stopped them (macro-only figures keep working).
   */
  readonly modifierTargets: Promise<void>;

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
    this.modifierTargets = this.ready.then(async () => {
      const r = await this.request({ type: "modifierTargets", id: 0 });
      if (r.type !== "modifierTargetsLoaded") throw new HumanoidWorkerError(`unexpected ${r.type}`);
    });
    // Held evaluations go once the targets settle: after a failure the worker
    // rejects each with the reason.
    const release = () => {
      this.modifierTargetsSettled = true;
      void this.pump();
    };
    this.modifierTargets.then(release, release);
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
   * Evaluates a recipe. `key` identifies the caller; a waiting request for the
   * same key is superseded and rejects with an `AbortError`.
   */
  evaluate(recipe: Recipe, key = "default"): Promise<Evaluation> {
    if (this.disposed) return Promise.reject(new HumanoidWorkerError("disposed"));
    return new Promise((resolve, reject) => {
      this.queue.get(key)?.reject(abortError());
      // Map.set on an existing key keeps its position, so a superseding
      // request keeps its caller's place in line.
      this.queue.set(key, { recipe, resolve, reject });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.running || this.queue.size === 0 || this.disposed) return;
    this.running = true;
    try {
      await this.ready;
    } catch (e) {
      this.running = false;
      this.failQueued(e instanceof Error ? e : new HumanoidWorkerError(String(e)));
      return;
    }
    const next = this.nextSendable();
    if (!next) {
      // Everything waiting needs the modifier targets; their arrival pumps again.
      this.running = false;
      return;
    }
    const [key, job] = next;
    this.queue.delete(key);
    try {
      const r = await this.request({ type: "evaluate", id: 0, recipe: job.recipe });
      if (r.type !== "evaluated") throw new HumanoidWorkerError(`unexpected ${r.type}`);
      job.resolve(r.evaluation);
    } catch (e) {
      job.reject(e instanceof Error ? e : new HumanoidWorkerError(String(e)));
    } finally {
      this.running = false;
      void this.pump();
    }
  }

  /** The first-queued job the worker can evaluate without waiting. */
  private nextSendable(): [string, Job] | undefined {
    for (const entry of this.queue)
      if (this.modifierTargetsSettled || !recipeSetsModifiers(entry[1].recipe)) return entry;
    return undefined;
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
