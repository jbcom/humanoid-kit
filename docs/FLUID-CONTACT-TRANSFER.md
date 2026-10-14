# Explicit paired fluid contact deposition

This is an internal, bounded contact operation. The caller supplies completed
poses for two identified figure states, their rendered placements, the exact
surface anchors selected for contact and a finite, non-negative `maxGapM` in
world metres. There is no default tolerance, contact search or inferred
material response.

`resolveFluidSurfaceContact` evaluates both anchors through `fluidAnchorPoint`
on those caller-completed frames. It preserves the caller's pose IDs and
generation identities. It checks the actual world-space gap, distinct figure
identities, compatible topology and invertible finite affine placements. An
ordinary object cannot substitute for resolved evidence. A selected point
changed after resolution rejects before any transfer.

`AttachedFluidField.depositOn(receiver, requests)` accepts exact kilograms and
a unique receiver record ID per request. The selected donor anchor must match
the live triangle/material cell. A receiver must explicitly declare
`maxDeposits` and `acceptedDepositMaterials`; omission disables receiving.
These identities select eligibility only, never adhesion, optical properties,
mobility or a physiological classification. Existing source-registration and
surface-only injection policy checks remain unchanged.

Every request, including later batch items, is validated before mutation.
Capacity, repeated record identity, ineligible material, source overdraw,
invalid geometry, stale contact or wrong source-pair evidence rejects the whole
batch. Both cell/deposit maps, immutable receipts and paired ledger replacements
are staged first. Successful transfer commits synchronously without callbacks.
It debits donor attached mass and credits receiver terminal deposited mass.
Neither figure's original emission counters or fixed-step clock advances.

The accounting equation for each state is:

```text
injectedTotalKg + receivedTotalKg
  = attachedKg + detachedKg + depositedKg + evaporatedKg
  + absorbedKg + escapedKg + transferredTotalKg
```

Across a closed set of figures, received and transferred totals cancel.
Transferred mass is not retained in the donor's deposited ledger as well.

`depositedFrame()` exposes immutable receiver-owned records containing the
source-pair identities, completed-pose identities, material, kilograms and both
anchors. `depositedCoverageSnapshot(currentFrame)` resolves each retained target
on the receiver's current posed surface. Multiple records on one
triangle/material retain their individual anchors while sharing one occupancy
support cell; support area is counted once. Deposits remain terminal through
`step`: receiver mobility cannot turn them into flowing attached liquid.

The existing water/sweat occupancy bridge accepts the explicitly labelled
deposited snapshot. It uses the same triangle/UV checks and per-figure support
texture as attached snapshots. This does not introduce a new material model,
new mesh, realistic water appearance, detached-particle impact handling,
automatic contact events, evaporation or serialized surface-store restoration.
Version-2 state checkpoints and explicit version-1 migration are described in
[Fluid state contract](FLUID-STATE-CONTRACT.md).

As with attached support, a triangle smaller than the 1024² mask's sampling
footprint can cover no texel centres. Retained mass and anchor geometry still
exist in that case, but the mask may display no occupancy. The native contact
capture deliberately selects a source limb cell whose UV support survives this
existing quantization; it does not establish visible support for every tiny
fingertip cell.
