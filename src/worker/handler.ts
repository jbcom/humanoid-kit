/**
 * The evaluation worker's message handling, apart from the worker global so it
 * can be driven directly (tests, or a host that runs it on its own thread).
 *
 * Packs load in stages (`loadHumanoidAssetsStaged`): `ready` is replied once
 * the first figure can be evaluated, while later target files are still
 * arriving, and a `complete` request is answered when all have. An evaluation
 * waits for the stages its recipe needs, without holding up any other request;
 * stages arrive one after another (`targetLoadOrder`), so a recipe needing a
 * late stage also waits out the ones before it. A recipe with an outfit, and a
 * request for a garment, wait for the clothing pack's garments the same way.
 * Results are transferred, not copied; the outfit masks the model caches are
 * copied first.
 */
import { wardrobeOf } from "../editor/wardrobe.ts";
import {
  ADULT_TARGET_FILE,
  GARMENTS_FILE,
  type LoadStage,
  loadHumanoidAssetsStaged,
} from "../format/assetFormat.ts";
import { buildFeatureMap } from "../makehuman/features.ts";
import { HumanoidModel } from "../model/humanoidModel.ts";
import { tryPresenceJoints } from "../presence/fromEvaluation.ts";
import type { Recipe } from "../recipe/recipe.ts";
import { rigData } from "../rig/pose.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

export type Post = (msg: WorkerResponse, transfer?: Transferable[]) => void;

/** Returns the function to call with each request; replies go through `post`. */
export function createWorkerHandler(post: Post): (req: WorkerRequest) => Promise<void> {
  let model: HumanoidModel | null = null;
  let stages: LoadStage[] = [];
  let complete: Promise<unknown> = Promise.resolve();
  /** The corner bake of a worn set the pack did not bake, made once. */
  let posedOcclusion: Promise<Float32Array[] | null> | null = null;
  /** Hair styles whose static data has gone to the client. */
  const sentHair = new Set<string>();

  /** Waits for the stages that bring the target files a recipe (in a skin state) needs. */
  const targetsFor = async (
    m: HumanoidModel,
    recipe: Recipe,
    signals: Readonly<Record<string, number>> = {},
  ): Promise<void> => {
    for (let pending = m.pendingTargetFiles(recipe, signals); pending.size; ) {
      const stage = stages.find((s) => s.files.some((f) => pending.has(f)));
      if (!stage) throw new Error(`no load stage brings ${[...pending].join(", ")}`);
      await stage.loaded;
      pending = m.pendingTargetFiles(recipe, signals);
    }
  };

  /**
   * Waits for the clothing pack's garments when `needed`. Without a clothing
   * pack there is no stage to wait for, and the model names the missing pack
   * itself.
   */
  const garmentsFor = async (m: HumanoidModel, needed: boolean): Promise<void> => {
    if (!needed || !m.assets.garmentsPending) return;
    await stages.find((s) => s.files.includes(GARMENTS_FILE))?.loaded;
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
          rig: { ...rigData(assets), parents: model.boneParents(), skin: model.rigSkin() },
          presenceJoints: tryPresenceJoints(assets),
          adultAnatomyLoaded: assets.adultAnatomyLoaded,
          hair: assets.hair && {
            styles: assets.hair.manifest.styles.map(({ id, label, tags, kind }) => ({
              id,
              label,
              tags,
              kind,
            })),
          },
          ...(assets.adultAnatomyManifest?.anatomy && {
            anatomy: assets.adultAnatomyManifest.anatomy,
          }),
          wardrobe: wardrobeOf(assets.clothingManifest),
        });
        return;
      }
      if (!model) throw new Error(`worker received ${req.type} before init`);
      if (req.type === "complete") {
        await complete;
        post({ type: "completed", id: req.id });
        return;
      }
      if (req.type === "posedOcclusion") {
        const m = model;
        posedOcclusion ??= (async () => {
          const steps = m.bakePosedOcclusion();
          for (;;) {
            const step = steps.next();
            if (step.done) return step.value;
            // A macrotask between corners lets queued evaluations run.
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        })();
        // Each request gets its own copies: the reply transfers them.
        const attachments = (await posedOcclusion)?.map((a) => a.slice()) ?? null;
        post(
          { type: "posedOcclusion", id: req.id, attachments },
          attachments?.map((a) => a.buffer) ?? [],
        );
        return;
      }
      if (req.type === "adultLayers") {
        // The adult pack's targets arrive in the last stage; wait for that one
        // only, then derive the adult layers' fields once and post them.
        const stage = stages.find((s) => s.files.includes(ADULT_TARGET_FILE));
        await stage?.loaded;
        const update = model.adultLayerFields();
        post(
          { type: "adultLayers", id: req.id, update },
          update ? [update.layerFields.buffer] : [],
        );
        return;
      }
      if (req.type === "adultSurface") {
        // The surface is the pack's refinement of the base body: built from its
        // manifest alone, so it needs no target stage. Each request gets its own
        // copies, since the reply transfers them.
        const t = model.adultSurface();
        const topology = t && {
          ...t,
          index: t.index.slice(),
          uvs: t.uvs.slice(),
          skinIndex: t.skinIndex.slice(),
          skinWeight: t.skinWeight.slice(),
          uvScale: t.uvScale.slice(),
        };
        post(
          { type: "adultSurface", id: req.id, topology },
          topology
            ? [
                topology.index.buffer,
                topology.uvs.buffer,
                topology.skinIndex.buffer,
                topology.skinWeight.buffer,
                topology.uvScale.buffer,
              ]
            : [],
        );
        return;
      }
      if (req.type === "pickMap") {
        await complete;
        const { features, vertexFeature } = buildFeatureMap(model.assets);
        // Built on every request; the client asks once and keeps the answer.
        const render = model.renderFeatures(vertexFeature);
        post({ type: "pickMap", id: req.id, features, render }, [
          render.body.buffer,
          ...(render.adultBody ? [render.adultBody.buffer] : []),
          ...render.attachments.map((a) => a.buffer),
        ]);
        return;
      }
      if (req.type === "garment") {
        await garmentsFor(model, true);
        // Copied, not transferred: the model keeps the topology for the next caller.
        post({ type: "garment", id: req.id, topology: model.garmentTopology(req.garment) });
        return;
      }
      await targetsFor(model, req.recipe, req.signals);
      // The worn style's files come on demand, like a target file, and only its own.
      const wanted = model.pendingHair(req.recipe);
      if (wanted !== null) await model.assets.hair?.load(wanted);
      await garmentsFor(model, (req.recipe.outfit?.length ?? 0) > 0);
      const t0 = performance.now();
      const evaluation = model.evaluate(req.recipe, req.signals, req.haveOutfit ?? null);
      const transfer: Transferable[] = [
        evaluation.positions.buffer,
        evaluation.normals.buffer,
        evaluation.control.buffer,
        evaluation.curvature.buffer,
        evaluation.boneHeads.buffer,
      ];
      for (const a of evaluation.attachments) transfer.push(a.positions.buffer, a.normals.buffer);
      if (evaluation.hair)
        transfer.push(evaluation.hair.positions.buffer, evaluation.hair.normals.buffer);
      for (const g of evaluation.garments) transfer.push(g.positions.buffer, g.normals.buffer);
      const masks = evaluation.outfit.masks;
      if (masks) {
        // The model caches the masks it works out, so what is transferred is a copy.
        const sent = {
          bodyIndex: masks.bodyIndex.slice(),
          garmentIndex: masks.garmentIndex.map((i) => i.slice()),
        };
        evaluation.outfit = { ...evaluation.outfit, masks: sent };
        transfer.push(sent.bodyIndex.buffer, ...sent.garmentIndex.map((i) => i.buffer));
      }
      // A style's static data goes once per worker: the client keeps it by id.
      const hairId = evaluation.hair?.id;
      const hairTopology = hairId && !sentHair.has(hairId) ? model.hairTopology(hairId) : undefined;
      if (hairId) sentHair.add(hairId);
      post(
        {
          type: "evaluated",
          id: req.id,
          evaluation,
          ms: performance.now() - t0,
          ...(hairTopology && { hairTopology }),
        },
        transfer,
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      post({ type: "error", id: req.id, message: error.message, name: error.name });
    }
  };
}
