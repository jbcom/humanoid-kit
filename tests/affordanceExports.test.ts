/**
 * The affordance API on the package's surface (docs/ARCHITECTURE.md,
 * "Affordances: the registry", "The public API"): the registry, state, frames
 * and channels, the landmarks and the posed body from `humanoid-kit`; the
 * handle, the anchor and the clip from `humanoid-kit/react`. The landmarks'
 * `Vec3` stays out of `humanoid-kit`, whose `Vec3` is presence's.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Vec3 } from "../src/index.ts";
import * as kit from "../src/index.ts";
import type { Vec3 as PresenceVec3 } from "../src/presence/presence.ts";
import * as react from "../src/react/index.ts";

const kinds = (entry: Record<string, unknown>, names: readonly string[]) =>
  Object.fromEntries(names.map((name) => [name, typeof entry[name]]));

describe("the affordance API on the package's surface", () => {
  it("offers the registry, state, frames, channels, landmarks and posed body from humanoid-kit", () => {
    const functions = [
      "affordances",
      "AffordanceStates",
      "changeState",
      "restState",
      "affordanceFrames",
      "affordanceFrameInto",
      "affordanceChannels",
      "affordanceChannel",
      "readLandmarks",
      "channelOf",
      "placeIn",
      "knotHalfSize",
      "landmarks",
      "frameOut",
      "posedSurface",
    ];
    expect(kinds(kit, functions)).toEqual(
      Object.fromEntries(functions.map((name) => [name, "function"])),
    );
    const objects = [
      "CORE_AFFORDANCES",
      "NO_AFFORDANCES",
      "CHANNELS",
      "LANDMARK_IDS",
      "SURFACE_LANDMARKS",
      "JOINT_LANDMARKS",
    ];
    expect(kinds(kit, objects)).toEqual(
      Object.fromEntries(objects.map((name) => [name, "object"])),
    );
    expect(kit.ADULT_EAR_SPAN).toBeGreaterThan(0);
    expect(kit.LANDMARK_IDS).toContain("ear-lobe.L");
  });

  it("offers the handle, the anchor and the clip from humanoid-kit/react", () => {
    const functions = [
      "useHumanoidAffordances",
      "AffordanceAnchor",
      "HumanoidAffordances",
      "ChannelClip",
      "clipMaterial",
    ];
    expect(kinds(react, functions)).toEqual(
      Object.fromEntries(functions.map((name) => [name, "function"])),
    );
    expect(react.CLIP_CHANNELS).toBeGreaterThanOrEqual(5);
    // The handle works without a figure: none of its own until it has a recipe.
    expect(new react.HumanoidAffordances().own).toEqual([]);
  });

  it("keeps humanoid-kit's Vec3 presence's, with the landmarks' frames their own type", () => {
    expectTypeOf<Vec3>().toEqualTypeOf<PresenceVec3>();
    expectTypeOf<kit.LandmarkFrame["position"]>().toEqualTypeOf<
      readonly [number, number, number]
    >();
    expectTypeOf<kit.LandmarkId>().toEqualTypeOf<(typeof kit.LANDMARK_IDS)[number]>();
    expectTypeOf<kit.PosedBody["surface"]>().toEqualTypeOf<"base" | "adult">();
  });
});
