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

`src/render/fluidCoverage.ts` binds one selected water or sweat material row from
that snapshot to the figure's own `hkFluidCoverage` vertex attribute and enables
the matching `SkinMaterial` shader variant. Every bind validates kilograms,
square metres, kilograms per square metre, metres, coverage range, and the
render geometry's vertex count. The next posed snapshot updates that attribute
in place. A `null` snapshot, or no row for the selected material, removes the
attribute and restores the byte-equivalent dry shader path.

The bridge uses the existing documented sweat-film roughness and specular
choices from `src/surface/regions/states.ts`; the coverage field itself still
does not choose optical constants. It deliberately does not use
`LayerFieldsUpdate.layerFields` in `src/surface/layers.ts`: those IDs are
planned into the body-wide `LayerAtlas`, which `src/render/layerAtlas.ts` shares
across figures. Each `SkinMaterial` may bind only one figure geometry, so two
figures cannot share dynamic coverage state. This remains a narrow water/sweat
wet-film renderer bridge, not droplets, detachment, pooling, contact transfer,
or a public full-fluid API.
