# Fluid and excretion system specification

Date: 2026-10-13. Status: proposed design, not an implementation. This is the
separate simulated system required by decision 8 in `docs/DECISIONS.md` for
beads, runs, drips, pooling, contact transfer and egress. It does not replace
the existing thin-film surface layers.

## Scope and terms

The system represents visible material on or leaving a posed figure. It covers
tears, sweat, saliva, mucus, blood, pus, vomit, urine, breast milk, genital
moisture, lubrication, semen, and feces. `Fluid` below includes a soft solid
only where that distinction is explicit. This is a visual and interaction
system; it makes no diagnostic, hygienic, health, identity, or behavioural
claim.

Every numeric value is marked as one of:

- **MEASURED**: a result with its specimen and measurement conditions.
- **CHOICE**: an engineering or art-direction value. It must never be presented
  as a human constant.
- **DERIVED**: a deterministic value calculated from stated state and choices.

No MakeHuman program code, GPL implementation, or copied simulation source is
an input to this work. The data and public contracts remain neutral.

## Existing contracts this extends

`SkinStateFilter` is a pure, exact first-order signal filter. Its current
`heat` rate is 40 s attack / 90 s decay and `exertion` is 20 s / 60 s; those
signals presently drive sweat **sheen**, not a moving liquid. The sweat map has
measured regional production rates, while its wetness mapping and optical
values are documented choices in `SKIN-STATES.md`.

`SurfaceLayer` and `LayerFieldsUpdate` describe shared static masks and paint
fields. They can still describe dry skin and thin films, but cannot hold
per-figure mass, a moving front, attachment, transfer, or detachment. The
fluid state must therefore be a separate per-figure object. It reads evaluated
positions, normals, triangles and pose, and never changes the body recipe.

Adult reservoirs already expose render-vertex canal ownership and per-canal
closed-lumen gap through `HumanoidModel.surface.canals`. That is enough to
locate a future aperture source once the adult pack and its aperture work are
present. It is not a claim that an aperture is open or a flow authorization.

## Required uses before selecting an algorithm

| Use | Required behaviour | Deliberate non-goal |
| --- | --- | --- |
| Many real-time figures | Stable, bounded-cost attached wetness; deterministic omission or coarsening under a declared budget; no cross-figure state leakage. | Full two-way Navier-Stokes coupling. |
| Full-fidelity creator | Inspectable source, material, mass, coverage, age and quality settings; close-up drips and residue remain anchored while the figure poses. | Medical realism or a universal body-fluid preset. |
| Offline capture | Fixed timestep, seeded emission and serializable checkpoints reproduce a shot exactly. Higher density may improve continuity. | Reusing a real-time result merely because it is deterministic. |
| Contact transfer | Fluid splits between source, receiver, emitted droplets and residue with a bounded mass ledger. Receiver surfaces declare their own interaction settings. | Inferring adhesion or contact angle from a fluid name. |
| Soft-solid egress | A canal-bound source can form, yield, stretch, split and deposit deformable clumps. | Treating stool as a Newtonian liquid or a rigid prefab. |

## Proposed public boundary

This is a proposal for a new `humanoid-kit/fluid` entry point. It keeps the
core free of React, DOM and WebGL. Rendering adapters consume frame output;
they do not decide material behaviour.

```ts
export type FluidKind =
  | "tear" | "sweat" | "saliva" | "mucus" | "blood" | "pus" | "vomit"
  | "urine" | "milk" | "genital-moisture" | "lubrication" | "semen" | "feces";

export type FluidPhase = "liquid" | "suspension" | "soft-solid";

export interface FluidMaterial {
  kind: FluidKind;
  phase: FluidPhase;
  /** CHOICE: renderer-facing optical values, never clinical colour data. */
  optical: { rgba: readonly [number, number, number, number]; roughness: number; ior: number };
  /** MEASURED only when provenance and conditions are supplied; otherwise CHOICE. */
  rheology: NewtonianRheology | ShearThinningRheology | ViscoplasticRheology;
  drying: { evaporation: number; absorption: number; residue: number };
  provenance?: MaterialProvenance;
}

export interface MaterialProvenance {
  source: string;
  temperatureC?: number;
  measurement: "kinematic-viscosity" | "dynamic-viscosity" | "apparent-viscosity" | "yield-stress";
  shearRateOrFrequency?: number;
  totalSolidsPercent?: number;
}

export interface ShearThinningParameters { consistency: number; flowIndex: number }
export interface NewtonianRheology { model: "newtonian"; kinematicViscosity: number }
export interface ShearThinningRheology extends ShearThinningParameters {
  model: "shear-thinning";
}
export interface ViscoplasticRheology extends ShearThinningParameters {
  model: "viscoplastic"; yieldStress: number; recovery: number;
}

export interface FluidQuality {
  tier: "film" | "particles" | "localized-solver";
  maxSurfaceCells: number;
  maxDroplets: number;
  maxSoftSolidClumps: number;
  solverSubsteps: number;
  contactTransfer: boolean;
}

export interface FluidSource {
  id: string;
  material: string;
  anchor: SurfaceAnchor | ApertureAnchor;
  rate: number;
  enabled?: boolean;
}
```

`FluidQuality` is typed because a renderer must not silently choose different
physics for the same authored figure. The initial defaults, cell size, particle
count, substeps, droplet radius, contact angle, gravity scale and all thresholds
are **CHOICE** values established only after a baseline on supported hardware.
The API validates finite non-negative rates and capacities, known material ids,
and a `soft-solid` material for extrusion. It rejects unknown adult apertures
rather than falling back to an arbitrary body point.

`FluidFrame` should expose a read-only mass ledger and renderable primitives:
attached surface cells, droplet instances, clump/strand instances, and residue
decals. A checkpoint includes all of that state plus the seeded PRNG and fixed
step accumulator. Consumers can therefore reproduce offline output without
reading renderer state.

## Sources, policy and access control

Body-wide sources such as lacrimal margins, sweat regions, mouth and injuries
may be defined by body-pack semantic anchors. Injury sources consume a future
regional injury event; this system neither opens nor diagnoses an injury.

Sources on genital or anal anatomy, and genital-fluid material bindings, are
adult-pack data. Their source registration and every nonzero emission request
must pass the existing age policy. A recipe below 18 fails with `AgePolicyError`
rather than reducing, hiding, or relocating the output. The public demo remains
unable to load adult sources because it cannot load the adult pack.

Nipple-associated milk is also represented as an adult-pack source binding.
This follows the package boundary already used for adult-only breast values and
avoids exposing an adult anatomical source from the body pack. It is an
engineering policy decision, not a claim about age or physiology.

## Surface representation and simulation

### Attached state

Each evaluated figure owns a sparse surface field keyed by stable rest-space
triangle/barycentric anchors. A cell holds mass, material id, age, temperature
input, wet/dry state, and optional local tangent direction. Each frame:

1. Reproject anchors through the current posed surface.
2. Add source and contact mass.
3. Move only across adjacent surface cells according to gravity projected onto
   the posed triangle, local coverage, and **CHOICE** mobility/adhesion.
4. Apply evaporation, absorption, coagulation/drying, or residue transitions.
5. Detach a droplet or clump only when a bounded **CHOICE** criterion is met.

The field follows skin through a rigid or articulated pose because anchors are
evaluated from the current skinned mesh. It does not require a volume solver to
remain attached. On a topology replacement, state is projected once from the
old rendered triangles to the new surface; unprojectable mass is emitted or
reported, never silently discarded.

### Detached state and contact transfer

Detached liquid is a deterministic particle set. Soft solid is a set of
cohesive clumps and connecting strands. Collision/contact returns a transfer
event that debits the source and credits retained receiver film, emitted state,
or residue. The ledger invariant is:

```text
emitted + attached + detached + residue + evaporated + absorbed == cumulative source
```

within a documented floating-point tolerance. A receiving surface supplies
capacity, mobility, adhesion and residue behavior. Those are **CHOICE** values
per material pair; the library does not assume values for skin, hair, fabric or
arbitrary host meshes.

At `film` tier, detachment and collisions are represented by deterministic
surface streaks/residue only. `particles` adds droplets and contact transfer.
`localized-solver` permits a bounded local simulation near an active source or
contact; it is optional. Published articulated-fluid work demonstrates costly
two-way coupling, while simplified character-fluid interaction is viable in
real time; this tiering is an engineering choice, not a result of either paper.

### Soft-solid extrusion

Feces uses `phase: "soft-solid"`, a viscoplastic rheology and an adult canal
aperture anchor. The low-cost path is cohesive clumps plus strands. A clump
remains attached until its regularized yield criterion and aperture constraint
allow displacement, then deforms, splits, transfers and deposits. The
high-quality path may reconstruct a local surface, but it must consume the same
ledger and produce the same coarse mass outcomes. It never uses a static asset
as a substitute for deformation or egress.

Fresh-feces experiments report 20--8,000 Pa yield stress across consistency and
solids, and shear thinning/thixotropy over 5--35% total solids. Those are
**MEASURED** ranges for the cited samples, not a default setting or an
individual classification. The proposal exposes yield stress, consistency,
flow index and recovery; selecting their default values remains a **CHOICE**.

## Material catalogue

| Group | Material behavior | Optical/lifetime behavior | Source boundary |
| --- | --- | --- | --- |
| Tears, sweat, urine | Liquid. Urine can use a documented near-water reference only with its measurement conditions. | Clear/refractive appearance and dry-down are CHOICE; sweat film remains the existing surface layer until flow is emitted. | Lacrimal/sweat body anchors; urine adult aperture. |
| Saliva, mucus | Shear-thinning liquid with optional elastic filament response. | Transparency, string lifetime and adhesion are CHOICE. | Mouth/body anchors. |
| Blood, pus | Blood needs a shear-rate- and concentration-dependent model; pus is a configurable suspension until direct evidence is supplied. | Blood oxidation/drying/crust transition is a CHOICE state machine, with persistent residue separate from moving liquid. | Injury event anchors. |
| Vomit | Configurable suspension with particulate payload. | Opacity, particle distribution and stain behaviour are CHOICE. | Mouth/body anchor. |
| Milk, genital moisture, lubrication, semen | Configurable liquid or shear-thinning liquid; no universal scalar is claimed. | Milky/translucent appearance and drying are CHOICE. | Adult-pack sources only. |
| Feces | Viscoplastic soft solid with history/recovery. | Opaque clumps, strands and residue are CHOICE. | Adult anal-aperture source only. |

The following presets are the only initial numeric reference candidates:

- **Urine, MEASURED reference:** 0.8293 +/- 0.0851 cSt at 37 C in 64 samples
  measured with a Cannon-Fenske viscometer. The same study reports 1.0700 +/-
  0.1076 cSt at 20 C and 0.6928 +/- 0.0247 cSt at 42 C. Temperature and
  protein affected the result; a preset stores these conditions rather than
  converting them into a universal dynamic viscosity.
- **Saliva, MEASURED conditional observation:** one submandibular study measured
  the real part of complex viscosity at 1.1 mPa s at 70 Hz and 0.95 mPa s at
  high frequency at 25 C. Whole saliva varies with stimulation and may be
  elastic/shear-thinning, so a stringiness control is a **CHOICE**.
- **Blood, MEASURED model requirement:** whole-blood measurements across 4.5--
  450 s^-1, 0--37 C and 15--35% hematocrit changed with shear rate,
  temperature and concentration. A single value labelled "human blood
  viscosity" is prohibited.
- **Feces, MEASURED behavior:** use the above yield-stress envelope only for
  authoring bounds and preserve a regularized-viscoplastic representation. It
  does not establish a default individual state.

## Bounded implementation slices

1. **Contract and inert state.** Add types, material validation, deterministic
   checkpoint/restore, source policy gates, and a mass ledger. No renderer.
2. **Attached liquid field.** Implement sparse posed-surface anchors, source
   injection, gravity-driven adjacency flow, film/residue transitions and a
   renderer-neutral frame output. Keep existing `SurfaceLayer` output unchanged.
3. **Detachment and transfer.** Add deterministic droplets, receiver contracts,
   collisions, transfer ledger and bounded particle quality tier.
4. **Adult source adapters.** Add aperture/nipple adapters only after their
   adult-pack anchor data exists; enforce age/adult-pack policy at registration
   and emission.
5. **Soft solid.** Add cohesive clumps/strands and viscoplastic extrusion;
   provide a localized high-quality implementation only after a real-time
   baseline establishes a budget.
6. **Renderer adapters and capture QA.** Render all phases, then use current
   posed captures to assess continuity, normal/lighting response, source
   placement and residue. This step has separate visual acceptance.

No slice requires a host application, external asset, or a new base mesh.

## Acceptance tests and performance proof

| Test | Acceptance condition |
| --- | --- |
| Determinism | Fixed seed, timestep and checkpoint produce byte-identical ledger/frame primitives across repeated runs. |
| Pose carriage | A head, torso and limb film remains on the same rest-space landmarks through representative rigid and articulated poses; no world-space sliding while no flow force acts. |
| Conservation | Sources, evaporation, absorption, attached, detached and residue satisfy the ledger equation after injection, transfer, split and topology reprojection. |
| Policy | Under-18 recipes reject every adult source and nonzero adult emission; adult data absent fails closed; ordinary tears/sweat continue to work. |
| Material contract | Urine provenance retains 37 C/kinematic conditions; blood rejects a scalar-only "human" preset; feces requires yield/recovery fields and an adult aperture. |
| Contact transfer | One controlled impact retains, emits and deposits only the declared shares, with no mass creation or cross-figure ownership leak. |
| Quality bounds | Each tier never exceeds its declared cell/droplet/clump capacities; overflow follows a deterministic documented coarsening path. |
| Soft-solid | A below-yield clump remains attached; a configured above-yield extrusion advances through its aperture, can split, and balances the ledger. |
| Visual QA | Current capture matrix covers front/side/normal-wire, dry/wet/residue, resting/moving pose, and every rendered phase. It checks no detached geometry starts inside the body, no seam leaks and no unexplained popping. |

Before declaring a tier ready, profile the actual implementation at each quality
tier with a declared figure count, fixed pose matrix, active source count,
timestep and hardware. Record P50/P95 frame time, peak memory, active cells,
drops/clumps and output capture ids. There is no numerical performance claim in
this specification because no implementation baseline exists yet.

## Sources (primary work)

- Inman BA et al., *International Journal of Hyperthermia* (2013), urine
  kinematic viscosity, DOI [10.3109/02656736.2013.775355](https://doi.org/10.3109/02656736.2013.775355).
- Waterman HA et al., *Archives of Oral Biology* (1988), submandibular saliva
  rheology, DOI [10.1016/0003-9969(88)90134-3](https://doi.org/10.1016/0003-9969(88)90134-3).
- Stokes JR and Davies GA, *Biorheology* (2007), whole-saliva
  rheology under stimulation, [PubMed 17851164](https://pubmed.ncbi.nlm.nih.gov/17851164/).
- Eckmann DM et al., *Anesthesia & Analgesia* (2000), blood viscosity over
  shear, temperature and hematocrit, DOI [10.1097/00000539-200009000-00007](https://doi.org/10.1097/00000539-200009000-00007).
- de Loubens C et al., *Techniques in Coloproctology* (2020), fresh-feces yield
  stress, DOI [10.1007/s10151-020-02174-0](https://doi.org/10.1007/s10151-020-02174-0).
- Mercer E et al., *Journal of Environmental Management* (2021), fresh-feces
  rheology and thixotropy, DOI [10.1016/j.jenvman.2021.113730](https://doi.org/10.1016/j.jenvman.2021.113730).
- Kwatra N et al. (2010), articulated-body/fluid coupling,
  [author manuscript](https://faculty.cc.gatech.edu/~turk/my_papers/fluid_articulated_bodies.pdf).
- Bermudez V et al. (2018), real-time simplified fluid interaction for
  locomotion, [author manuscript](https://people.computing.clemson.edu/~vbz/papers/bermudez_2018_RLC.pdf).
