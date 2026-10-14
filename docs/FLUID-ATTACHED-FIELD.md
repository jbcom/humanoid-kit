# Attached fluid field (phase 2)

`src/fluid/attachedField.ts` is internal. It keeps a sparse surface-only field
on a caller-supplied posed frame. `FluidState` remains the only mass ledger:
field insertion prevalidates capacity and anchors before its one ledger
injection, and transport only moves existing attached mass between adjacent
triangles.

The bounded field rejects a new triangle/material identity at capacity rather
than coalescing or discarding it. It has no renderer, droplets, contact
transfer, residue, adult aperture adapter, or mesh changes.

## Coverage output

`AttachedFluidField.coverageSnapshot(frame)` is an immutable, renderer-neutral
view of the actual sparse cells on one matching posed frame. It records
conserved attached mass in kilograms, support area in square metres, areal mass
density in kilograms per square metre, posed anchor coordinates in metres, and
per-material vertex support coverage. A present sparse cell occupies its whole
triangle support (`coverage: 1`); this is not optical alpha, film thickness, or
a material response. The existing `FLUID_MASS_EPSILON_KG` ledger tolerance
applies to the snapshot's attached-mass check as well as state and transport.

The existing wet-film material interface cannot consume this output directly:
`LayerFieldsUpdate.layerFields` in `src/surface/layers.ts` only refreshes IDs
already planned into the body-wide `LayerAtlas`, which `src/render/layerAtlas.ts`
shares across figures. Fluid coverage varies per figure and pose. The next
renderer boundary is therefore a per-figure dynamic coverage atlas or vertex
attribute sampled by `SkinMaterial`, while material-specific optical values stay
outside this field contract.
