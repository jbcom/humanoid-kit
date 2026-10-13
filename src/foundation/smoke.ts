/**
 * How the smoke tier's invariant suite is run, shared by its test and by
 * `scripts/foundation-smoke.ts`, which records its results: the surface as
 * drawn (one level of subdivision) and penetration counted at every welded
 * vertex. Sampled at every fourth, the area was the sample's, not the skin's:
 * any change of topology renumbered the vertices after it and drew another
 * sample, and the canals' patches moved m-muscular overhead from 24.97 cm² to
 * 31.00 at the shoulders, where every vertex counted gives 35.39 both times.
 * Counting all of them costs the tier about a minute and a half on one host.
 */
import type { ModelOptions } from "../model/humanoidModel.ts";

export const smokeModelOptions: ModelOptions = { subdivision: 1 };

export const SMOKE_STRIDE = 1;
