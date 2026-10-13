/** Grafting a foreign part onto a figure as one surface (docs/GRAFT.md). */
export { type ControlMesh, type ResolvedCut, resolveFaceCut, resolvePlaneCut } from "./cut.ts";
export { type Similarity, similarityFit } from "./fit.ts";
export { buildGraft, type Graft, type GraftBody, type GraftCutInput } from "./graft.ts";
export {
  arcParams,
  boundaryEdges,
  fairLoop,
  maxTurn,
  orderLoops,
  sampleLoop,
  weldByPosition,
} from "./loops.ts";
export {
  graftOnModel,
  type ModelGraft,
  type ModelGraftInput,
  type ModelSurface,
} from "./onModel.ts";
export { CUT_SITES, type CutSite } from "./sites.ts";
export {
  type GraftCut,
  GraftError,
  type GraftFit,
  type GraftGroup,
  type GraftOptions,
  type GraftPart,
  type GraftPlane,
  type GraftSpec,
  type GraftSurface,
  type GraftTopology,
  type PartGroup,
  type PartSeam,
} from "./types.ts";
