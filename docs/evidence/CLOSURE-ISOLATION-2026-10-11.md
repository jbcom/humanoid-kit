# Closure isolation: 2026-10-11

This continues the interrupted recovery on `feat/female-form`, from `d04feba`.
The integration ref remains `4504756`; this is diagnostic evidence, not an
accepted form or release.

## A corrected three-dimensional gap

The existing zero-gap closure removed the across coordinate but retained each
skin side's depth. A tilted-loop regression reproduced a 0.918 mm separation
along the normal (`render-3efc66cfe0a8407893c1f9a98707aec4`, expected failure).
`closedLoop` now intersects both loop sides at each longitudinal coordinate and
uses their mean depth. The optional finite slit length scales that depth curve.

After regeneration, seven closure, six resting visibility and nine pack tests
passed. The foundation test still failed thirteen checks across nine posed
rows. Receipt: `render-83dfdbeee13445e08e868a3b41eb771c`, `.201`; 24 passed,
one failed. Typecheck and focused Biome checks pass.

The adult pack generation completed; the subsequent redundant hair phase was
canceled with exit 130. The generated body matched HEAD, and only this command's
hair outputs were restored to their initially clean HEAD state. The new adult
outputs remain. The complete pack command is not claimed as passing.

## Geometry versus shading

Fresh silent Metal sheets passed without retries on `.202`, receipt
`render-76002ee3b4ce4fffbc66a85178f51b08`. Both front-low and below-close images
still show the raised rim and pinched seams. They are visually rejected.

The temporary `.sheets/closure-measures.ts` compares resting geometry with and
without closure metadata, using the same generated targets. With closure,
face/normal inversions rise from 210 to 274 on the slim figure, 234 to 311 on the
heavy figure and 177 to 207 on the male figure. Recomputing area-weighted
triangle normals still yields extra inversions (211 to 268, 239 to 321 and
176 to 203). Removing radial-fold displacements changes only a few faces.
These comparisons support investigating positions, not changing normals alone.
They are diagnostic counts, not the official foundation inversion metric.

## Pose isolation

The temporary `.sheets/closure-smoke.ts` runs the official smoke measurements
with closure metadata disabled, radial folds disabled, anal closure alone and
vaginal closure alone. These are counterfactuals of the current generated
targets; disabling metadata does not reconstruct the old pack. They cannot
justify restoring a baseline or replacing acceptance tests.

Disabling closure entirely still regresses twelve checks against the worklist.
Disabling radial folds still regresses fourteen. Anal closure alone reproduces
all the male regressions of the full closure: muscular seated penetration,
muscular squat inversions, and heavy male seated/squat inversions. The next
position investigation can therefore isolate the anal closure for these rows.
Vaginal closure alone still regresses eleven checks. Its male rows match the
no-closure counterfactual, as expected because their vaginal target has zero
weight. Receipt: `render-551bfff6d6ea4894a766d5c134909abd`, `.201`, exit 0.
The diagnostic command completed successfully; it reports regressions rather
than asserting acceptance, so its exit code is not a passing foundation gate.

## Unfinished source transfer

The retained source directory has no NIH hood/glans cuts, cut provenance or
landmark fit. The smallest phallic key still calls `phallusGeometry`. The
female hood/glans transfer in section 6f of the sculpt plan remains planned;
the plan and source provenance now state this explicitly. No source transfer
or female-form acceptance is implied by the existing licence entries.

No foundation tolerance was loosened, and no lane was integrated or published.
