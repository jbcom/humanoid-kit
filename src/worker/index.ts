/**
 * Worker entry: owns one `HumanoidModel` and evaluates recipes off the main
 * thread. Results are transferred, not copied.
 *
 * Packs load in two stages: the worker replies `ready` once a figure built from
 * macros can be evaluated, while the modifier targets are still arriving, and
 * answers a `modifierTargets` request when they have. A recipe that sets a
 * shape modifier waits for them; one that does not evaluates at once.
 */
import { loadHumanoidAssetsStaged } from "../format/assetFormat.ts";
import { HumanoidModel } from "../model/humanoidModel.ts";
import { recipeSetsModifiers } from "../recipe/recipe.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

let model: HumanoidModel | null = null;
let modifierTargets: Promise<unknown> = Promise.resolve();

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  self.postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === "init") {
      const staged = await loadHumanoidAssetsStaged(req.load);
      const { assets } = staged;
      modifierTargets = staged.modifierTargets;
      // A failure is reported to the evaluation that needs the targets.
      modifierTargets.catch(() => {});
      model = new HumanoidModel(assets, req.model);
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
    if (req.type === "modifierTargets") {
      await modifierTargets;
      post({ type: "modifierTargetsLoaded", id: req.id });
      return;
    }
    // The client holds these back until the targets arrive; a direct caller
    // still gets a correct result, only later.
    if (recipeSetsModifiers(req.recipe)) await modifierTargets;
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
