export * from "./affordance/armSkinnedFrameSampler.ts";
export * from "./affordance/channel.ts";
export * from "./affordance/frames.ts";
export * from "./affordance/regionalContact.ts";
export * from "./affordance/registry.ts";
export * from "./affordance/state.ts";
export * from "./animation/index.ts";
export * from "./bake/decimate.ts";
export * from "./bake/figure.ts";
export {
  createFigureSnapshotProducer,
  type FigureSnapshot,
  type FigureSnapshotBounds,
  type FigureSnapshotEpochs,
  FigureSnapshotError,
  type FigureSnapshotIndexSelection,
  type FigureSnapshotOptions,
  type FigureSnapshotPart,
  type FigureSnapshotProducer,
} from "./bake/figureSnapshot.ts";
export * from "./bake/format.ts";
export * from "./bake/miniature.ts";
export * from "./bodyArt/decals.ts";
export * from "./bodyArt/ink.ts";
export * from "./bodyArt/jewellery.ts";
export * from "./bodyArt/markShape.ts";
export * from "./bodyArt/marks.ts";
export * from "./bodyArt/sites.ts";
export * from "./bodyArt/vitiligo.ts";
export * from "./build/surfaceMesh.ts";
export * from "./editor/controls.ts";
export * from "./editor/cover.ts";
export * from "./editor/eyeMaterials.ts";
export * from "./editor/framing.ts";
export * from "./editor/gate.ts";
export * from "./editor/history.ts";
export * from "./editor/limits.ts";
export * from "./editor/randomize.ts";
export * from "./editor/regional.ts";
export * from "./editor/wardrobe.ts";
export * from "./eyes/index.ts";
export * from "./format/assetFormat.ts";
// Named, not `*`: its `Vec3` is presence's too.
export {
  type FrameOut,
  frameOut,
  JOINT_LANDMARKS,
  LANDMARK_IDS,
  type LandmarkFrame,
  type LandmarkId,
  landmarks,
  SURFACE_LANDMARKS,
} from "./foundation/landmarks.ts";
export { type PosedBody, posedSurface } from "./foundation/posed.ts";
export * from "./graft/index.ts";
export * from "./injury/index.ts";
export * from "./interaction/contacts.ts";
export * from "./interaction/definition.ts";
export * from "./interaction/handContact.ts";
export * from "./interaction/runtime.ts";
export * from "./interaction/siteContact.ts";
export * from "./interaction/siteContactConstraint.ts";
export * from "./makehuman/customTargets.ts";
export * from "./makehuman/features.ts";
export * from "./makehuman/macro.ts";
export * from "./makehuman/recipeMorph.ts";
export * from "./makehuman/regions.ts";
export * from "./makehuman/stateMorphs.ts";
export * from "./model/garmentLook.ts";
export * from "./model/humanoidModel.ts";
export * from "./model/outfit.ts";
export * from "./model/proxy.ts";
export * from "./model/rigidFit.ts";
export * from "./model/skinQuality.ts";
export * from "./morph/evaluate.ts";
export * from "./presence/fromEvaluation.ts";
export * from "./presence/presence.ts";
export * from "./random.ts";
export * from "./recipe/agePolicy.ts";
export * from "./recipe/anatomy.ts";
export * from "./recipe/bodyArt.ts";
export * from "./recipe/recipe.ts";
export * from "./recipe/validate.ts";
export * from "./rig/armTarget.ts";
export * from "./rig/dual.ts";
export * from "./rig/expressions.ts";
export * from "./rig/faceMirror.ts";
export * from "./rig/faceSignals.ts";
export * from "./rig/flexion.ts";
export { type FoldSetup, solveFold } from "./rig/foldSolve.ts";
export {
  FOLD_JOINTS,
  type FoldJointName,
  foldFlexion,
  jointRotations,
  jointTurns,
} from "./rig/folds.ts";
export { foldSides, HIP_FOLD, hipFlexion, hipRotation } from "./rig/hipFold.ts";
export { hipFoldSetup, solveHipFold, solveHipFoldSteps } from "./rig/hipFoldSolve.ts";
export {
  addFold,
  addFoldNormal,
  type FoldJoint,
  flexedPast,
  foldAngles,
  type JointFlexion,
  type JointFold,
  renderFold,
  rowTexels,
  type SurfaceFold,
  surfaceFold,
} from "./rig/jointFold.ts";
export { KNEE_FOLD, kneeFlexion, kneeRotation, kneeSides } from "./rig/kneeFold.ts";
export { kneeFoldSetup, solveKneeFold, solveKneeFoldSteps } from "./rig/kneeFoldSolve.ts";
export * from "./rig/occlusionKeys.ts";
export * from "./rig/pose.ts";
export * from "./rig/skinShare.ts";
export * from "./sampling.ts";
export * from "./subdiv/catmullClark.ts";
export * from "./surface/beard.ts";
export * from "./surface/bodyHair.ts";
export * from "./surface/bodyOcclusion.ts";
export * from "./surface/cielab.ts";
export * from "./surface/coat.ts";
export * from "./surface/hairTone.ts";
export * from "./surface/handTone.ts";
export * from "./surface/layers.ts";
export * from "./surface/occlusion.ts";
export * from "./surface/preintegration.ts";
export * from "./surface/regions/index.ts";
export * from "./surface/scatter.ts";
export * from "./surface/scatterTable.ts";
export * from "./surface/skinStateFilter.ts";
export * from "./surface/skinTone.ts";
export * from "./worker/client.ts";
