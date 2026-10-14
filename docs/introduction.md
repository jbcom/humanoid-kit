---
title: humanoid-kit
description: Parametric human figures for three.js and React Three Fiber, built from one CC0 base mesh and a serializable recipe.
---

humanoid-kit builds a figure from a small, explicit description instead of from a
collection of authored models. Every figure is one CC0 base mesh deformed by
morph targets, so a single skeleton and a single set of skin weights serve all of
them. The description is a recipe: plain JSON that you can store, send and
replay.

> **Pre-release, API in development.** Nothing is published yet. These pages
> document what exists in the repository today; names, defaults and file layouts
> will change before `0.1.0`. Planned work is labelled as planned.

## Packages

| Package | Licence | Contents |
| --- | --- | --- |
| `humanoid-kit` | MIT | Asset loading, recipes, the age policy, evaluation, subdivision, rig and poses, animation playback, presence, interactions, the worker client, the React bindings and the creator |
| `humanoid-kit-body` | CC0 1.0 | The base mesh, shape targets for every age MakeHuman models (1 to 90 years), the 163-bone skeleton and skin weights, facial pose units and 275 shape modifiers |
| `humanoid-kit-adult-anatomy` | CC0 1.0 | 96 adult-only targets and 12 modifiers (9 with sliders; 3 retained legacy ids). A separate install |
| `humanoid-kit-hair` | Per-asset licences; see attribution | 41 hair entries bound to the base body: 16 scalp styles, 12 eyebrows, 4 eyelashes and 9 facial-hair entries. Select beard and moustache assets independently through `recipe.facialHair`. A separate install; the explicit CC0-only profile excludes attributed assets |
| `humanoid-kit-eyes` | CC0 1.0 | 32 eye materials: human irises, cats' slit pupils, toon and creature eyes. A separate install |
| `humanoid-kit-animations` | CC0 1.0 | 98 clips (walks, idles, swims, combat, sitting and more) on the default skeleton, played on any figure. A separate install |
| `humanoid-kit-clothing` | CC0 1.0 | 87 garments bound to the base mesh, with the skin each hides. A separate install |

The body and adult packs together carry 287 shape modifiers. An application that never
installs the adult anatomy pack cannot render adult anatomy at all, and one that
never installs the hair pack never downloads hair.

## Entry points

| Entry point | Contents | Dependencies |
| --- | --- | --- |
| `humanoid-kit` | Loading, recipes, age policy, `HumanoidModel`, subdivision, surface builder, `HumanoidWorkerClient` | none beyond the packs |
| `humanoid-kit/react` | `HumanoidProvider`, `Humanoid`, `useHumanoidClient`, `useHumanoidReady`, the presence bindings (`PresenceProvider`, `usePresence`, `useProximity`), `Miniatures`, `StudioStage`, `HumanoidAffordances` | `react`, `@react-three/fiber`, `three` |
| `humanoid-kit/editor` | `HumanoidCreator`, a tap-to-edit creator over the recipe, `useHumanoidEditor`, `SliderRow` | `react`, `@react-three/fiber`, `three` |
| `humanoid-kit/worker` | The worker module the client starts by default | none |

React, React Three Fiber and drei are optional peer dependencies. The core entry
point imports no React or three.js; it returns typed arrays that you can turn
into geometry yourself, and it runs in Node, which is how its tests run.

## What it does today

| Need | How |
| --- | --- |
| Many figures without many models | One base mesh; variation comes only from morph targets |
| Change one body part without disturbing another | Per-region macro overrides, blended smoothly across joints |
| Every age, with a firm line on anatomy | All ages 1 to 90; adult-only controls are rejected under 18, never clamped, and adult anatomy is a separate package |
| Large character data that loads quickly | Compact binary files read as typed-array views, with no parsing step |
| Smooth surfaces without stalling a frame | Catmull-Clark stencil subdivision evaluated in a Web Worker, latest request wins |
| Sharing a figure without shipping a model | A recipe is small serializable data |

## What is planned

Anthro traits, fur, scales and feathers as layers, a doll form and an adult
animation package (pending an owner ruling on its
scope) are planned, and beards are in progress. Clothing, scalp and body hair, animation, rig and poses,
expressions, presence, the creator and the first interaction slices ship. The
[architecture notes](ARCHITECTURE.md) list the roadmap with each milestone's
status.

Start with [Getting started](getting-started.md), then read the
[API reference](API.md) and the [architecture notes](ARCHITECTURE.md).
