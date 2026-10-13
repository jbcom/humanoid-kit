# Adult-age surface coverage diagnosis

**Status:** read-only gap record. The reviewed age-70 rest capture is not accepted as meeting the near-realistic adult-age target.

## Evidence boundary

The comparison used the same balanced male anchor, rest pose, head preset, and enlarged head framing at ages 30 and 70. The reviewed age-70 capture shows an age-dependent change in facial shape and folds, but the skin remains visually smooth and uniform at that framing. This report traces what the implementation actually supplies; it does not claim that metadata or unit coverage proves visual quality.

## Current age path

| Layer | Direct trace | What it does | Limitation at rest |
| --- | --- | --- | --- |
| Head/body shape | `src/makehuman/macro.ts` maps the age in years through the baby, child, young, and old anchors. `macroTargetWeights` emits the weighted `macrodetails` targets; `src/makehuman/recipeMorph.ts` evaluates them. The body pack ships `targets-old.bin.gz`. | Supplies the observed age-dependent macro shape. | It cannot provide skin albedo, roughness variation, or microrelief by itself. |
| Base skin material | `src/react/Humanoid.tsx` passes `recipe.macros.age` to `SkinMaterial.setAppearance`. `src/render/skinMaterial.ts` uses a generated, shared 256×256 pore normal map and constant base roughness `0.52`. | Supplies uniform pore-scale normal variation and physically based base response. | There is no age-indexed body albedo, normal, roughness, or displacement map in `SkinRecipe`, `SkinAppearance`, or `packs/body/data`. |
| Static regional skin | `SkinPaintInput` carries age. Current age-dependent regional layers cover plantar callus/ridges, areola/nipple development, body-hair defaults, and striae maturity. | Provides legitimate regional age behavior. | These mechanisms do not create an old-age facial surface at the reviewed rest framing. |
| Expression lines | `src/surface/regions/faceLines.ts` multiplies line relief and shading by `expressionAgeFactor(age)`, but every expression-line layer also takes its strength from a `face.*` signal. | Makes an expressed face's lines deeper/darker with age. | In the reviewed rest pose those signals are zero, so the expression-line layers paint no wrinkle. They are not static age-wrinkle coverage. |
| Optional body art | `recipe.bodyArt` can provide scars, marks, tattoos, and vitiligo. | Allows deliberate authored marks. | It is optional user content and is not an age-surface system. |

## Asset and material findings

The body pack lists a body mesh, target archives, attachments, occlusion data, eye texture, tooth texture, and tongue texture. It contains no skin albedo, age-map, wrinkle normal, roughness, or displacement asset. `SkinRecipe` exposes melanin, haemoglobin, undertone, non-natural colour override, flush, lip depth, and areola depth; it carries no age-surface field. The generated pore normal map is shared across every figure and is intentionally faint (`normalScale` 0.06), so it cannot encode individual age cues.

This separates two facts that must not be conflated:

- the old macro targets are present and produce age-related geometry; and
- the rest-state facial material lacks an age-specific surface signal.

## Actionable implementation gaps

1. **Rest-state face-age layer.** Add an explicit, validated age-surface input that produces regional, tone-aware static age cues in the face at rest. It must be independent from expression signals and must remain compatible with saved recipes that omit it.
2. **Age-surface representation decision.** Choose and document whether the first implementation is procedural regional fields, sourced maps, or a hybrid. The choice needs provenance, colour/roughness/normal behavior, and a defined quality tier; a uniform global noise gain is not sufficient.
3. **Material contract.** Carry the chosen age-surface signal through `Recipe` → `Humanoid` → `SkinMaterial` and the layer atlas with explicit defaults, serialization, and no gender-driven lock. Existing age geometry and expression signals should remain independently testable.
4. **Evaluation contract.** Compare ages 30/50/70/90 for at least light, medium, and deep skin tones in rest and expression views. The review needs front, three-quarter, and side close framing plus normal whole-figure framing; screenshots and a material-state assertion complement each other, but neither replaces the other.
5. **Performance contract.** Measure shader variants, atlas pages, texture bytes, and representative frame cost before choosing maps or additional procedural layers. Do not introduce an age-specific heavy path without a bounded tier and fallback plan.

No source, recipe schema, pack, or renderer change is made by this diagnosis.
