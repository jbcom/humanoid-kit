# Attached fluid field (phase 2)

`src/fluid/attachedField.ts` is internal. It keeps a sparse surface-only field
on a caller-supplied posed frame. `FluidState` remains the only mass ledger:
field insertion prevalidates capacity and anchors before its one ledger
injection, and transport only moves existing attached mass between adjacent
triangles.

The bounded field rejects a new triangle/material identity at capacity rather
than coalescing or discarding it. It has no renderer, droplets, contact
transfer, residue, adult aperture adapter, or mesh changes.
