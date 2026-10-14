# Fluid state contract (phase 1)

`src/fluid/state.ts` is a framework-free, internal contract for per-figure fluid
state. It has no renderer export, public package entry, flow solver,
collision behaviour or pose evaluation. Explicit paired contact deposition is
described in [Fluid contact transfer](FLUID-CONTACT-TRANSFER.md).

A state binds its sources and checkpoint to an exact body `topology` and
`bodySha256`. Surface sources use a rest-space triangle and barycentric weights;
this is a separate contract from regional injury's base-mesh vertex anchor and
has no automatic conversion to it.

Mass is recorded in kilograms. `injectedTotalKg + receivedTotalKg` equals the
sum of `attachedKg`, `detachedKg`, `depositedKg`, `evaporatedKg`, `absorbedKg`,
`escapedKg` and `transferredTotalKg`. Received mass is not a new source
emission; transferred mass no longer belongs to the donor. Paired transfers
stage and validate both ledgers before changing either one.
Detached mass is still tracked; detaching transfers mass and never escapes it.
Only an explicit terminal settlement can add `escapedKg`.

An adult-aperture source requires an adult recipe, the actually loaded adult
anatomy pack bound to the same body, and a declared reservoir with a canal. The
state accepts no caller-provided profile or permission boolean, and it does not
substitute a surface source when that feature is absent. Asset-profile metadata
remains the packer's responsibility.

Snapshots carry a uint32 seed, fixed timestep in seconds, and a fixed-step
count. Phase 1 keeps advancement inert so checkpoint/restore and mass accounting
are deterministic before any motion model is introduced.

The current state checkpoint is version 2. Restore explicitly accepts the exact
version-1 ledger schema and migrates `receivedTotalKg` and `transferredTotalKg`
to zero; malformed or mixed-version fields reject. Original source injection
totals, seed, fixed steps and topology binding survive the migration. State
checkpoints record mass, not the attached field's cells or retained deposit
records.
