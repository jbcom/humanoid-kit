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
on rendered images. A procedural substitute is a documented last resort for a gap
no CC0 source fills (for example the relaxation that gives a flat chest baseline).
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
