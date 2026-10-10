export type { BodyArtImages } from "../render/bodyArtTexture.ts";
export { applyDualSkinning, DualBones } from "../render/dualSkinning.ts";
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
export type { HumanoidAnimation } from "./useFigureAnimation.ts";
export { type SkinStateFilterOptions, useSkinStateFilter } from "./useSkinStateFilter.ts";
