# Maintainer rulings

Decisions the maintainers have made, recorded so they are applied and not
reopened. Each entry says what was decided and what follows from it. A change that
contradicts an entry needs a new ruling first, recorded here, not an issue that
argues the point again.

## 1. There is one human model, not a male and a female one

`gender` is a skeletal-frame blend between two data anchors. It is not an identity
and not a gate. Every other trait moves independently, in either direction or both:
frame per region (`regionalMacros`), muscle, fat, chest tissue, nipple and areola,
pelvis and external anatomy, body and facial hair, skin and fur.

- No trait may be multiplied, clamped or switched off by `gender`. Where code does
  that today (breast weights, body hair, the adult pack's default anatomy, the
  areola size), it is a defect to remove, not a rule to keep.
- Any combination of traits is a legal figure, including combinations of
  traditionally separate sets. Adult anatomy is a set of independent, explicit
  choices, not a presumption derived from the frame.

## 2. Assets first, procedural last

For every body region, the first step is to use what MakeHuman's core data and the
CC0 community assets already provide, grafted onto the base mesh, and to accept it
on rendered images. Procedural substitutes are no longer an agent's call: see
ruling 8, which supersedes the earlier "documented last resort" allowance.
Grafting a foreign part so that it is one continuous surface is a core capability
of the kit (issue 11), not an optional extra.

## 3. MakeHuman parity is the contract

humanoid-kit is a system for using MakeHuman. A developer who builds a figure in
MakeHuman by hand, with its macros, modifiers, targets, proxies, skeleton, poses,
expression units and materials, and then moves to the kit, must get the same figure
and no surprise. MakeHuman's data and taxonomy already settle the questions: macro
anchors and ranges, the target families, the modifier groups and their sliders, the
age anchors, which assets exist and how they bind.

- The kit adds no judgement, restriction, clamp or refusal of its own on top of what
  MakeHuman does. Where it does today, that is drift to remove.
- The kit's own additions (a worker, interaction signalling, layers MakeHuman does
  not have) sit beside MakeHuman's behaviour and never change what a MakeHuman
  recipe produces.
- A deviation needs an owner ruling and an entry in the parity ledger, with the
  reason. Do not re-argue what upstream decided; read what its data does.

## 4. The age line

The kit follows MakeHuman at every age it models (1 to 90 years): its shape
targets, breast development through adolescence, nipples and areolae. The one
boundary is the one MakeHuman itself draws, which keeps genital assets out of its
core:

- The age axis is MakeHuman's own timeline, with no deviation (owner ruling,
  2026-10-13): baby at 1 year, child at 10, the adult body (`young` in its
  files) at 25, old at 90, linear between them. A figure of 18 is about 47%
  child shape, as in MakeHuman. The earlier hold of the adult body from 18 to
  25 is reversed; `ADULT_AGE` (18) gates content only, never the body's shape.
- Adult-only: the adult anatomy pack (genital, bulge and pregnancy targets and
  modifiers) and pubic hair density, evaluated only for figures aged 18 or over.
- Not restricted at any age: nipples and areolae (relief and surface), breast
  development and the breast macros (`breastSize`, `breastFirmness`, regional breast
  values) as MakeHuman's age interpolation produces it, and a child's ordinary
  non-genital torso. These are core body features, present on every frame.
- Documentation that says otherwise (an invariant that breast values throw under
  18) is stale and is corrected to the code and this entry.
- The review sheets put every figure under 18 in a cover garment. That is how the
  sheets were designed, not a legal requirement, and it needs no change.

## 6. Judge by intent and by what MakeHuman already decided

Before a feature, a layer or an asset is questioned, restricted or refused, two
questions settle it:

1. Is the layer already adjudicated by MakeHuman? MakeHuman's core and community
   assets define what exists and what is allowed at every age. A layer MakeHuman
   ships or leaves unrestricted (a child's natural form, nipples, tattoos and other
   body marks, clothing, hair) is not restricted by the kit.
2. What is the intent? Depicting the natural human form is not sexualised content.
   Only content made to be sexual is, and the kit keeps that in the adult pack,
   for adult figures, as ruling 4 says.

Neither a body region's presence nor a figure's age is a reason to raise a
restriction question. Where an audit finds no gate in MakeHuman for a layer, that
is the answer.

## 5. Adult interaction is for all-adult participants, with explicit consent

Interaction between figures is a multi-party contract, not a pair and not a
default orientation. Which body regions take part is derived from the anatomy each
figure actually has, never from its frame value. Each region has its own contact
and response channel: the mouth, ingestion and egress, other adult openings, and
birth are separate functions and are never one shared "opening". Adult interactions
refuse any participant under 18, and consent is never assumed.

## 7. An adult anatomy value that is absent means its default; an explicit zero means zero

Recorded 2026-10-13 as the semantic the code already implements (issue 26, commit
cb2e5c17), with the owner's confirmation of the wording still to come. It is a
maintainer design decision, not an owner ruling.

- A recipe that does not name an adult anatomy modifier gets the adult pack's
  default for it when the figure is an adult and the pack is loaded.
- A recipe that names the modifier with 0 gets 0: the default is overridden, and
  the editor preserves that explicit zero.
- A control shows the effective value, the same one evaluation applies, so it never
  reads 0 while the default is drawn (`sliderValue` with the loaded anatomy
  defaults). Resetting a row removes the override so the default resumes.
- Under 18 nothing changes: adult modifiers are refused or removed as ruling 4
  says, whatever the defaults are.

## 8. Procedural geometry is for internal canals only; anything else is vetted by the owner

Owner ruling, 2026-10-13. Hair, beards, moustaches, body hair, eyebrows, skin
detail, outer anatomy and every other visible surface come from CC0 (or
otherwise permitted) assets, grafted and bound the MakeHuman way (`.mhclo`
attachments, `src/graft`), and are accepted on rendered images. Procedural
generation (cards or shells made by code, code-drawn forms, painted-in-shader
substitutes) is approved only for internal canals (urethra, vagina, anus and
their apertures), where no asset exists.

- Any other procedural element needs the owner's explicit vetting before it is
  built or kept: the issue states what asset search was done (catalogue, packs,
  community pages), why nothing fits, and what the procedural piece is; the owner
  answers; the answer is recorded here with the element it covers.
- Work already on the shared line that violates this is audited and replaced by
  grafts, or listed here with the owner's vetting. Until an element is vetted it
  is not extended, polished or defended.
- A surface that looks wrong is first checked for being procedural: a failing
  look is a reason to switch to an asset, not to tune the generator.
- **Fluids are exempt (owner, 2026-10-13).** Tears, sweat, saliva, mucus, blood,
  pus, vomit, urine, breast milk, genital moisture, lubrication, semen, feces and
  every other body fluid or excretion cannot come from an asset: they move and
  deform, so they are simulated, as the canals are drawn. Feces is a soft solid,
  not a liquid, so its simulation covers plastic deformation as well as flow. A thin film is a material state, a skin
  layer that changes roughness and specular over a mask (sweat sheen,
  `VULVA_MOISTURE_LAYER`); beads, runs, drips, pooling and flow are a separate
  simulated system over the posed surface, specified and tested on its own issue.

## 9. Commercial-use asset licences are accepted with their required attribution

Owner ruling, 2026-10-13: "any license permitting commercial use is totally
acceptable. Documenting attribution is perfectly fine for OSS projects."

Asset intake is not restricted to CC0. CC-BY assets, including NIH 3DPX-017321,
may be evaluated and incorporated with their actual licence, source, author,
attribution and modifications recorded in provenance and NOTICE. Verify that
the licence permits commercial use and the redistribution being performed.
Do not describe an attributed asset as CC0 or change the licences of existing
pack entries. This ruling changes asset eligibility; source-to-pack validation
and rendered anatomical acceptance still apply. The restriction against copying
MakeHuman program code and ruling 8's procedural geometry boundaries remain.

Owner extension, 2026-10-13: provide an explicit CC0-only asset build profile.
It excludes attributed asset data and reports the corresponding features as
unavailable. The commercial-use profile includes permitted attributed assets
with their required notices. This profile governs asset data, not the code's
MIT licence. Pack metadata, shipped files, attribution and feature availability
must agree with the selected profile; no hidden procedural substitute is added.

## 10. The kit exposes MakeHuman; it does not design replacement models

Owner clarification, 2026-10-13: this kit is an API in front of MakeHuman.
Preserve the source meshes and expose their capabilities through the kit's
loaders, controls, bindings and independently written proxies. Do not author
new meshes or turn integration into a separate modelling or art-design effort.
Approved procedural work must meet the source material's quality; decision 8's
exception boundaries remain in force.

Every MakeHuman community or GitHub asset package with CC0, CC-BY or another
commercially redistributable licence merits consideration. Inventory its actual
capabilities, provenance, compatibility and integration needs rather than
selecting by a human-versus-AI preference or an invented art direction. Decision
9 governs asset licences, attribution and the CC0-only build profile. Source
fidelity and current rendered proof remain necessary before acceptance.

## 11. Comprehensive capabilities include coordinated multi-party animation

Owner clarification, 2026-10-13: this is the definitive humanoid kit, not a
curated slice of MakeHuman capabilities. The integration program considers all
commercially redistributable MakeHuman ecosystem capabilities under decisions
9 and 10. Compatibility work and staged delivery do not define permanent scope
exclusions.

Figures must be able to animate and communicate through reflective presence.
The signaling plan must support a complex choreographed sequence with five or
fifty participants: each figure exposes its active animation, seeks one or more
partners when a cycle requires them, and participates in coordinating the cycle.
This requirement extends the multi-party contract in decision 5 and
`docs/PRESENCE.md`; it is a delivery requirement, not a claim that choreography,
partner discovery or fifty-participant coordination is already implemented.

## 12. Asset intake is confirmed once; delivery focuses on working capabilities

Owner direction, 2026-10-13: unpack, confirm once, commit, and use Git LFS if
needed. Commit the optimized asset outputs rather than the larger original
distribution. Decide storage from the actual output sizes. Do not make repeated
packaging checks or expanding data-validation matrices a substitute for building
the API. Revisit intake only when the source or transformation changes or a
concrete defect requires it. Tests and visual checks focus on actual runtime,
animation, communication and rendering behavior.

Decisions are appended with the next number and never renumbered, since code and
docs cite the numbers. A decision that comes from a design section (dated, in the
architecture notes or a research document) is summarised here with a pointer, so
this file is the index of what was decided and why.

## 13. Source-derived endpoints are retained without aesthetic substitution

The independent regional breast path uses evaluated MakeHuman source controls and
targets on hm08. If a source endpoint is position-identical to MakeHuman, its
local relief is retained rather than smoothed, sculpted, or replaced for taste.
The acceptance requirement is source identity plus an inspected rendering, not a
new locally authored shape.
