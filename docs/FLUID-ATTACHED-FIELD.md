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
that snapshot to one per-figure, nearest-filtered 1024² UV coverage texture and
enables the matching `SkinMaterial` shader variant. Each snapshot cell carries
the three source-frame vertex IDs for its triangle. Binding rejects a render
geometry whose indexed triangle does not match those IDs, so a clothing or other
surface with reordered indices cannot receive body support accidentally.

The bridge marks texel centres at `(i + 0.5) / 1024` inside each occupied
`cells[].triangle`. This is a binary texture quantization of triangle support,
not exact geometric coverage; its boundary can differ from the mesh support by
one texel. It rejects occupied triangles with degenerate, out-of-range, or
interior-overlapping UV support. `vertexCoverage` is validated as snapshot
metadata but is not interpolated by the shader. This avoids the wider support of
vertex interpolation, which reaches every face incident to a covered vertex and
can expand a local field across its triangle fan. The source-body proof reports
both counts so that this difference remains inspectable.

Every bind validates kilograms, square metres, kilograms per square metre,
metres, coverage range, and the render geometry's vertex count. The next posed
snapshot updates that texture in place. A `null` snapshot, or no row for the
selected material, disables the wet shader variant and restores the
byte-equivalent dry path. The texture belongs to one `SkinMaterial` and its one
body geometry, avoiding an additional vertex attribute on the already dual-skinned
source body and preventing figures from sharing dynamic coverage state. Rebinding
either one releases and disposes the old figure-local texture before creating the
new binding.

The bridge retains only the last validated triangle/source-ID support key per
render geometry. A repeated support selection can reuse its selected-by-all UV
overlap check, while every bind still checks the current indexed triangle order,
source IDs, finite in-range UVs, and selected-triangle degeneracy. Rebinding or
disposing a geometry drops that cache; coverage changes do not grow a history.

The bridge uses the existing documented sweat-film roughness and specular
choices from `src/surface/regions/states.ts`; the coverage field itself still
does not choose optical constants. It deliberately does not use
`LayerFieldsUpdate.layerFields` in `src/surface/layers.ts`: those IDs are
planned into the body-wide `LayerAtlas`, which `src/render/layerAtlas.ts` shares
across figures. Each `SkinMaterial` may bind only one figure geometry, so two
figures cannot share dynamic coverage state. This remains a narrow water/sweat
wet-film renderer bridge, not droplets, detachment, pooling, contact transfer,
or a public full-fluid API.
