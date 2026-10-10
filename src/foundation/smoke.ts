/**
 * How the smoke tier's invariant suite is run, shared by its test and by
 * `scripts/foundation-smoke.ts`, which records its results: the surface as
 * drawn (one level of subdivision) and penetration sampled at every fourth
 * welded vertex.
 */
import type { ModelOptions } from "../model/humanoidModel.ts";

export const smokeModelOptions: ModelOptions = { subdivision: 1 };

export const SMOKE_STRIDE = 4;
