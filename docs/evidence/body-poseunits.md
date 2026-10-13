# MakeHuman's body pose units are not packed

An audit of `poseunits/body-poseunits.json` in the pinned upstream tree (commit
`a8bc2d54ff0ac92e78ff71431b1023eda42bf482`, recorded in
`packs/body/data/PROVENANCE.md`), against the 60 face units the body pack does
carry. It settles issue 58, item 1, under owner ruling 3 (`docs/DECISIONS.md`):
parity means what MakeHuman does with its data.

## Decision

The 61 body pose units are **not packed**. Decision: leave them out and say why
here. Why: MakeHuman never reads the file, so packing it is not parity, and it
cannot be packed without a bone map and unit labels the kit would have to invent.
This is not a deviation from MakeHuman: a MakeHuman recipe never uses these units.

## What the file is

| Property | Face units | Body units |
| --- | --- | --- |
| Frames | `face-poseunits.bvh`, one BVH frame per unit | none: no BVH exists for the body units |
| Unit names | `face-poseunits.json` `framemapping`, 60 names | `body-poseunits.json` `poses`, 61 keys |
| Rotation | Euler channels per joint, about axis-aligned rest frames | a quaternion (w, x, y, z) per joint, bone-local |
| Joints per unit | all 163, most at rest | 1 to 7 named bones |
| Sides | `Left` and `Right` units, both in the data | `Left` units only, yet 13 joint entries name `.R` bones |
| Licence field | `"license": "CC0"` | none; only the upstream LICENSE.md's "Poses and expressions" category covers it |
| Read by MakeHuman | the expression mixer, the posing tab, the collada exporter, the scripting API | by nothing |

The last row was checked in the upstream application repository: every reader of
`poseunits/` names `face-poseunits.json` and `face-poseunits.bvh`, and a code
search for the body file's name finds no reader.

## Why it cannot be packed faithfully

1. **No BVH, so the face units' path does not apply.** `parseBvh` and
   `frameRotations` read Euler channels. The body file holds quaternions, 5 of
   whose 215 entries are not unit length.
2. **The rotations are bone-local.** Every finger unit is a pure rotation about the
   bone's local X axis. The kit poses about axis-aligned rest frames
   (ARCHITECTURE.md, "Skeleton, poses and expressions"), so these would need each
   bone's rest frame from its roll plane applied as a conjugation, a mapping
   MakeHuman does not define for this file.
3. **It is keyed to a skeleton the default rig is not.** 24 of its joint names are
   not among the 163 bones: `spine1` to `spine4`, `shoulder.L`, `scapula.L`,
   `upperleg.L`, `neck`, `heel.L`, `metatarsal1` to `5`, `collisionArm1.L`,
   `collisionArm2.L`, `collisionLeg0.L` to `collisionLeg2.L`, `platysma03` and
   `platysma06` on both sides, `special02`. Of the 61 units, 29 name only bones the
   default rig has, 24 name some of them and 8 name none.
4. **The labels contradict the content.** Examples:
   - `HeadTurnRight` and `HeadTurnLeft` move the wrist and metacarpals;
   - `UpperArmUpLeft1` and `UpperArmUpLeft2` move mouth bones (`oris01`, `oris02`);
   - `TorsoDown` and `TorsoUp` move the head and neck;
   - `Finger1CloseLeft` and `Finger2CloseLeft` move the heel and metatarsals;
   - `Toe1CloseLeft` and `Toe2CloseLeft` move the thumb's base joint;
   - the finger-close and finger-open units sit two places out of step with their
     names (`Finger3CloseLeft` curls the `finger1` chain, `Finger1OpenLeft` the
     `finger4` chain).

A pack that keeps upstream's names would ship units whose names move the wrong
joints; one that fixes them needs a legacy-to-default bone map and relabelled
units, both a judgement of the kit's laid over MakeHuman's data, which ruling 3
rules out.

## What covers the same ground

The body is posed by whole-body poses (`bodyPoseRotations`: MakeHuman's `tpose`
and `benchmark`, and the poses authored here) and by animation clips, with the
face by the 60 face units. The `benchmark` pose bends every joint to an extreme and
is the joint-extreme check.

## If it is ever wanted

An owner ruling would need to say which of three it is: a legacy-skeleton import
(map the retired names to the default rig, with the mapping reviewed bone by
bone), a relabelling (units renamed for what they move), or leaving the file out,
which is where this stands. The file stays reproducible from the pinned commit.
