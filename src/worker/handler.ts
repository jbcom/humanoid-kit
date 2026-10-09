/**
 * The evaluation worker's message handling, apart from the worker global so it
 * can be driven directly (tests, or a host that runs it on its own thread).
 *
 * Packs load in stages (`loadHumanoidAssetsStaged`): `ready` is replied once
 * the first figure can be evaluated, while later target files are still
 * arriving, and a `complete` request is answered when all have. An evaluation
 * waits for the stages its recipe needs, without holding up any other request;
 * stages arrive one after another (`targetLoadOrder`), so a recipe needing a
 * late stage also waits out the ones before it. Results are transferred, not
 * copied.
 */
import { type LoadStage, loadHumanoidAssetsStaged } from "../format/assetFormat.ts";
import { buildFeatureMap } from "../makehuman/features.ts";
import { HumanoidModel } from "../model/humanoidModel.ts";
import type { Recipe } from "../recipe/recipe.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

export type Post = (msg: WorkerResponse, transfer?: Transferable[]) => void;

/** Returns the function to call with each request; replies go through `post`. */
export function createWorkerHandler(post: Post): (req: WorkerRequest) => Promise<void> {
  let model: HumanoidModel | null = null;
  let stages: LoadStage[] = [];
  let complete: Promise<unknown> = Promise.resolve();

  /** Waits for the stages that bring the target files a recipe needs. */
  const targetsFor = async (m: HumanoidModel, recipe: Recipe): Promise<void> => {
    for (let pending = m.pendingTargetFiles(recipe); pending.size; ) {
      const stage = stages.find((s) => s.files.some((f) => pending.has(f)));
      if (!stage) throw new Error(`no load stage brings ${[...pending].join(", ")}`);
      await stage.loaded;
      pending = m.pendingTargetFiles(recipe);
    }
  };

  return async (req) => {
    try {
      if (req.type === "init") {
        const staged = await loadHumanoidAssetsStaged(req.load);
        const { assets } = staged;
        stages = staged.stages;
        complete = staged.complete;
        model = new HumanoidModel(assets, req.model);
        const bake = model.occlusionBakeRecipe();
        if (bake) await targetsFor(model, bake);
        const topology = model.topology();
        post({
          type: "ready",
          id: req.id,
          topology,
          modifiers: [...assets.modifiers.values()],
          sliders: assets.sliders,
          bones: assets.manifest.skeleton.bones.map((b) => b.name),
          adultAnatomyLoaded: assets.adultAnatomyLoaded,
        });
        return;
      }
      if (!model) throw new Error(`worker received ${req.type} before init`);
      if (req.type === "complete") {
        await complete;
        post({ type: "completed", id: req.id });
        return;
      }
      if (req.type === "pickMap") {
        await complete;
        const { features, vertexFeature } = buildFeatureMap(model.assets);
        // Built on every request; the client asks once and keeps the answer.
        const render = model.renderFeatures(vertexFeature);
        post({ type: "pickMap", id: req.id, features, render }, [
          render.body.buffer,
          ...render.attachments.map((a) => a.buffer),
        ]);
        return;
      }
      await targetsFor(model, req.recipe);
      const t0 = performance.now();
      const evaluation = model.evaluate(req.recipe);
      const transfer: Transferable[] = [
        evaluation.positions.buffer,
        evaluation.normals.buffer,
        evaluation.control.buffer,
        evaluation.curvature.buffer,
      ];
      for (const a of evaluation.attachments) transfer.push(a.positions.buffer, a.normals.buffer);
      post({ type: "evaluated", id: req.id, evaluation, ms: performance.now() - t0 }, transfer);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      post({ type: "error", id: req.id, message: error.message, name: error.name });
    }
  };
}
