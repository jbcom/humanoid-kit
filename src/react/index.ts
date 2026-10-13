export type { AffordanceSpace, Capsule, LiveFigure } from "../affordance/live.ts";
export { applyGarmentWear } from "../render/attachmentLook.ts";
export type { BodyArtImages } from "../render/bodyArtTexture.ts";
export { ChannelClip, CLIP_CHANNELS, clipMaterial } from "../render/channelClip.ts";
export {
  applyDualSkinning,
  DualBones,
  ensureSkinPlaces,
  FOLD_SLOTS_ATTRIBUTE,
  foldSlotAt,
  foldSlotComponent,
  makeFoldSlots,
  readSkinAttributes,
  setSkinAttributes,
  writeFoldSlots,
} from "../render/dualSkinning.ts";
export {
  MiniatureCrowd,
  type MiniatureCrowdOptions,
  type MiniatureFigure,
  type MiniatureFrameStats,
  type MiniatureTint,
  projectedPixels,
  VAT_WIDTH,
} from "../render/miniature.ts";
export {
  applyShadowFilter,
  patchShadowFilter,
  SHADOW_FILTER_KEY,
} from "../render/shadowFilter.ts";
export {
  configureKeyShadow,
  KEY_SHADOW,
  type KeyShadowFrame,
  type KeyShadowOptions,
  keyShadowFitter,
  STUDIO_SHADOW_MAP_TYPE,
} from "../render/studioShadow.ts";
export {
  AffordanceAnchor,
  HumanoidAffordances,
  useHumanoidAffordances,
} from "./affordances.tsx";
export {
  Humanoid,
  type HumanoidPick,
  type HumanoidPose,
  type HumanoidPresenceProps,
  type HumanoidProps,
  HumanoidProvider,
  useHumanoidClient,
  useHumanoidReady,
} from "./Humanoid.tsx";
export { Miniatures, type MiniaturesProps } from "./Miniatures.tsx";
export {
  PresenceProvider,
  type PresenceRef,
  usePresence,
  usePresenceRegistry,
  useProximity,
} from "./presence.tsx";
export {
  STUDIO_EXPOSURE,
  STUDIO_SHADOWS,
  STUDIO_TONE_MAPPING,
  StudioStage,
  type StudioStageProps,
} from "./StudioStage.tsx";
export type {
  AnimationContactPoint,
  HumanoidAnimation,
  HumanoidAnimationContact,
  HumanoidAnimationFrame,
} from "./useFigureAnimation.ts";
export { type SkinStateFilterOptions, useSkinStateFilter } from "./useSkinStateFilter.ts";
