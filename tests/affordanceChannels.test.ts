/**
 * The channels behind the body's apertures (src/affordance/channel.ts,
 * docs/ARCHITECTURE.md, "Affordances: curved channels",
 * docs/research/AFFORDANCE-CHANNELS.md): their cited paths and sizes, which
 * points they hold, and how they follow the figure's size, pose and the
 * mouth's opening.
 */
import { describe, expect, it } from "vitest";
import {
  ADULT_EAR_SPAN,
  CHANNEL_SECTIONS,
  CHANNELS,
  type Channel,
  type ChannelId,
  channelKnots,
  channelThrough,
  placeIn,
} from "../src/affordance/channel.ts";
import { affordanceChannels } from "../src/affordance/frames.ts";
import { affordances } from "../src/affordance/registry.ts";
import { AffordanceStates } from "../src/affordance/state.ts";
import { landmarks, type Vec3 } from "../src/foundation/landmarks.ts";
import { REST_POSE } from "../src/foundation/permutations.ts";
import { posedSurface } from "../src/foundation/posed.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
const along = (p: Vec3, d: Vec3, k: number): Vec3 => [
  p[0] + d[0] * k,
  p[1] + d[1] * k,
  p[2] + d[2] * k,
];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = length(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const degrees = (a: Vec3, b: Vec3) =>
  (Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * 180) / Math.PI;

const figure = (macros: Record<string, number>, mouth = 0, pose = REST_POSE) => {
  const recipe = createRecipe({ macros });
  const own = affordances(recipe);
  const states = new AffordanceStates(own);
  states.set("mouth", { opening: mouth });
  const body = posedSurface(model, recipe, pose);
  return {
    body,
    channels: affordanceChannels(model, body, own, states),
    marks: landmarks(model, body),
  };
};

/** A channel through `points` with half-sizes `halves`, its `up` along +z at the rim. */
function through(points: readonly Vec3[], halves: readonly (readonly [number, number])[]): Channel {
  const k = channelKnots();
  k.count = points.length;
  points.forEach((p, i) => {
    k.points.set(p, i * 3);
    k.halves.set(halves[i] as readonly [number, number], i * 2);
  });
  return channelThrough(k, [0, 0, 1]);
}

/** A path in the z = 0 plane that turns right by 90 degrees, then on. */
const elbow = () =>
  through(
    [
      [0, 0, 0],
      [0, 0.02, 0],
      [0.02, 0.04, 0],
      [0.04, 0.04, 0],
    ],
    [
      [0.004, 0.003],
      [0.004, 0.003],
      [0.003, 0.002],
      [0.003, 0.002],
    ],
  );

describe("a channel's path", () => {
  it("passes through its knots, a section on each, the same number of steps across each span", () => {
    const c = elbow();
    expect(c.sections).toHaveLength(CHANNEL_SECTIONS);
    const per = (CHANNEL_SECTIONS - 1) / 3;
    const knots: Vec3[] = [
      [0, 0, 0],
      [0, 0.02, 0],
      [0.02, 0.04, 0],
      [0.04, 0.04, 0],
    ];
    knots.forEach((k, i) => {
      const s = c.sections[i * per];
      if (!s) throw new Error(`no section ${i * per}`);
      expect(length(sub(s.centre, k)), `knot ${i}`).toBeLessThan(1e-12);
    });
    // Its depth is its length, section by section.
    let run = 0;
    c.sections.forEach((s, i) => {
      if (i > 0) run += length(sub(s.centre, (c.sections[i - 1] as typeof s).centre));
      expect(s.depth).toBeCloseTo(run, 12);
    });
    expect(c.depth).toBeCloseTo(run, 12);
    // Leaving the rim toward the second knot and arriving along the last span.
    // (An end plane's normal is its one segment's chord, a step into the curve.)
    expect(degrees(c.inward, [0, 1, 0])).toBeLessThan(3);
    expect(degrees((c.sections.at(-1) as (typeof c.sections)[0]).normal, [1, 0, 0])).toBeLessThan(
      3,
    );
  });

  it("carries its cross-section along without twisting, square to the path", () => {
    const c = elbow();
    for (const s of c.sections) {
      // A path in a plane keeps the axis out of it.
      expect(degrees(s.up, [0, 0, 1])).toBeLessThan(1e-6);
      expect(Math.abs(dot(s.across, s.normal))).toBeLessThan(1e-9);
      expect(Math.abs(dot(s.up, s.normal))).toBeLessThan(1e-9);
      expect(length(s.across)).toBeCloseTo(1, 12);
    }
  });

  it("holds points on and round its curved path, and none in front of its rim, past its end or beyond its wall", () => {
    const c = elbow();
    for (const [i, s] of c.sections.entries()) {
      const inner = i === 0 ? along(s.centre, s.normal, 1e-6) : s.centre;
      const at = placeIn(c, inner);
      expect(at.inside, `section ${i}`).toBe(true);
      expect(at.depth, `section ${i}`).toBeCloseTo(s.depth, 5);
      if (i === 0 || i === c.sections.length - 1) continue;
      expect(
        placeIn(c, along(s.centre, s.across, s.halfAcross * 0.95)).inside,
        `${i} near the side`,
      ).toBe(true);
      expect(
        placeIn(c, along(s.centre, s.across, s.halfAcross * 1.05)).inside,
        `${i} side wall`,
      ).toBe(false);
      expect(placeIn(c, along(s.centre, s.up, s.halfUp * 0.95)).inside, `${i} near the top`).toBe(
        true,
      );
      expect(placeIn(c, along(s.centre, s.up, -s.halfUp * 1.05)).inside, `${i} bottom wall`).toBe(
        false,
      );
    }
    expect(placeIn(c, along(c.origin, c.inward, -0.002))).toEqual({
      depth: expect.closeTo(-0.002, 9),
      inside: false,
    });
    const end = c.sections.at(-1) as (typeof c.sections)[0];
    const past = placeIn(c, along(end.centre, end.normal, 0.002));
    expect(past.inside).toBe(false);
    expect(past.depth).toBeCloseTo(c.depth + 0.002, 9);
    // Where a straight channel from the rim would run, past the bend, is outside it.
    expect(placeIn(c, along(c.origin, c.inward, 0.035)).inside).toBe(false);
  });

  it("refuses knots it cannot sample evenly, or that coincide", () => {
    const k = channelKnots();
    k.count = 6;
    expect(() => channelThrough(k, [0, 0, 1])).toThrow(RangeError);
    k.count = 2;
    expect(() => channelThrough(k, [0, 0, 1])).toThrow(RangeError);
  });
});

const MM = 0.001;
/** Section `i`'s ellipse area, square millimetres. */
const area = (c: Channel, i: number) => {
  const s = c.sections[i];
  if (!s) throw new Error(`no section ${i}`);
  return (Math.PI * s.halfAcross * s.halfUp) / (MM * MM);
};
/** The section on knot `k` of a spec with `knots` knots. */
const onKnot = (c: Channel, knots: number, k: number) => {
  const s = c.sections[(k * (CHANNEL_SECTIONS - 1)) / (knots - 1)];
  if (!s) throw new Error(`no section on knot ${k}`);
  return s;
};
/** How far the path turns at knot `k`: between the chords from the knot before and to the knot after. */
const turnAt = (c: Channel, knots: number, k: number, after = k + 1) => {
  const a = onKnot(c, knots, k - 1).centre;
  const b = onKnot(c, knots, k).centre;
  const d = onKnot(c, knots, after).centre;
  return degrees(sub(b, a), sub(d, b));
};
/** How far the path turns from its first segment to its last. */
const turnOverall = (c: Channel) => {
  const s = c.sections;
  const n = s.length;
  const at = (i: number) => (s[i] as (typeof s)[0]).centre;
  return degrees(sub(at(1), at(0)), sub(at(n - 1), at(n - 2)));
};
/** The head's frame as a test reads it: across from the left ear canal to the right, up toward the crown, forward toward the nose. */
function head(marks: ReturnType<typeof landmarks>) {
  const l = marks["ear-canal.L"].position;
  const r = marks["ear-canal.R"].position;
  const centre: Vec3 = [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2];
  const right = unit(sub(r, l));
  const toCrown = sub(marks.crown.position, centre);
  const up = unit(sub(toCrown, along([0, 0, 0], right, dot(toCrown, right))));
  const across: Vec3 = [
    up[1] * right[2] - up[2] * right[1],
    up[2] * right[0] - up[0] * right[2],
    up[0] * right[1] - up[1] * right[0],
  ];
  const forward =
    dot(across, sub(marks["nose-tip"].position, centre)) > 0
      ? across
      : along([0, 0, 0], across, -1);
  return { centre, right, up, forward, span: length(sub(r, l)) };
}

describe("the core channels", { timeout: 300_000 }, () => {
  it("are the research note's sizes", () => {
    const ear = CHANNELS.auditory.rim;
    expect((Math.PI * ear.across * ear.up) / 4 / (MM * MM)).toBeCloseTo(101.5, 6);
    expect(ear.up / ear.across).toBeCloseTo(7.75 / 6.1, 9);
    expect(CHANNELS.nasal.rim).toEqual({ across: 0.0105, up: 0.015 });
    expect(CHANNELS.oral.rim.up).toBe(0.0457);
  });

  it("are for the default adult's head, whose ear canals are ADULT_EAR_SPAN apart", () => {
    const { marks } = figure({ age: 25 });
    expect(head(marks).span).toBeCloseTo(ADULT_EAR_SPAN, 3);
  });

  it("frame the head square to itself, up and forward on the figure at rest", () => {
    const h = head(figure({ age: 25 }).marks);
    expect(degrees(h.up, [0, 1, 0])).toBeLessThan(5);
    expect(degrees(h.forward, [0, 0, 1])).toBeLessThan(5);
  });

  it("are behind each of the head's openings, oriented as the openings are", () => {
    const { channels } = figure({ age: 25 }, 1);
    expect(Object.keys(channels).sort()).toEqual([
      "ear-canal.L",
      "ear-canal.R",
      "mouth",
      "nostril.L",
      "nostril.R",
    ]);
    // An ear canal is taller than wide; a nostril runs front to back; the mouth is wide
    // across the face and opens up and down.
    for (const side of ["L", "R"] as const) {
      const ear = channels[`ear-canal.${side}`];
      const nose = channels[`nostril.${side}`];
      if (!ear || !nose) throw new Error(side);
      expect(Math.abs(ear.up[1]), `ear ${side}`).toBeGreaterThan(0.8);
      expect(Math.abs(nose.up[2]), `nostril ${side}`).toBeGreaterThan(Math.abs(nose.up[0]));
    }
    const mouth = channels.mouth;
    if (!mouth) throw new Error("no mouth");
    expect(Math.abs(mouth.across[0])).toBeGreaterThan(0.9);
    expect(Math.abs(mouth.up[1])).toBeGreaterThan(0.8);
  });

  it("run into the head from each opening", () => {
    const { channels, marks } = figure({ age: 25 }, 1);
    const { centre } = head(marks);
    const from = (p: Vec3) => length(sub(p, centre));
    for (const [id, c] of Object.entries(channels)) {
      const end = c.sections.at(-1) as (typeof c.sections)[0];
      expect(from(end.centre), id).toBeLessThan(from(c.origin));
    }
  });

  it("run the ear canal's S: its length, its bends where and as far as they turn, its sections", () => {
    const { channels, marks } = figure({ age: 25 });
    const h = head(marks);
    const scale = h.span / ADULT_EAR_SPAN;
    const knots = CHANNELS.auditory.knots.length;
    for (const side of ["L", "R"] as const) {
      const ear = channels[`ear-canal.${side}`];
      if (!ear) throw new Error(side);
      const id = `ear-canal.${side}`;
      // 30.9 mm from the entrance to the annulus (the curve a little longer than its chords).
      expect(ear.depth / scale / MM, id).toBeGreaterThan(30.9);
      expect(ear.depth / scale / MM, id).toBeLessThan(30.9 * 1.02);
      // The first bend 5.3 mm in, the second 15.1 mm in.
      expect(onKnot(ear, knots, 1).depth / scale / MM, id).toBeCloseTo(5.3, 0);
      expect(onKnot(ear, knots, 2).depth / scale / MM, id).toBeCloseTo(15.1, 0);
      // Turning 41° at the first bend and 26° at the second (the isthmus lies on the bony run).
      expect(turnAt(ear, knots, 1), id).toBeCloseTo(41.0, 0);
      expect(turnAt(ear, knots, 2, 4), id).toBeCloseTo(25.8, 0);
      // The annulus 28.3 mm toward the midline from the entrance and 9.3 mm behind it.
      const into = sub(onKnot(ear, knots, 4).centre, ear.origin);
      // Toward the midline: toward the other ear.
      const medial = side === "L" ? 1 : -1;
      expect((dot(into, h.right) * medial) / scale / MM, id).toBeCloseTo(28.33, 1);
      expect(dot(into, h.forward) / scale / MM, id).toBeCloseTo(-9.34, 1);
      // Its sections: the entrance, first bend, second bend, isthmus and annulus areas.
      [101.5, 64.5, 49.0, 32.4, 63.7].forEach((want, k) => {
        const s = (k * (CHANNEL_SECTIONS - 1)) / (knots - 1);
        expect(area(ear, s) / scale ** 2, `${id} knot ${k}`).toBeCloseTo(want, 6);
      });
    }
  });

  it("turn the nostril's vestibule back into the passage, through its valve", () => {
    const { channels, marks } = figure({ age: 25 });
    const scale = head(marks).span / ADULT_EAR_SPAN;
    const knots = CHANNELS.nasal.knots.length;
    for (const side of ["L", "R"] as const) {
      const nose = channels[`nostril.${side}`];
      if (!nose) throw new Error(side);
      const id = `nostril.${side}`;
      expect(turnOverall(nose), id).toBeGreaterThan(85);
      expect(turnOverall(nose), id).toBeLessThan(95);
      // The valve about 20 mm in, 54 mm² across; the passage on to 92 mm in.
      expect(onKnot(nose, knots, 2).depth / scale / MM, id).toBeGreaterThan(19);
      expect(onKnot(nose, knots, 2).depth / scale / MM, id).toBeLessThan(23);
      expect(area(nose, 2 * 8) / scale ** 2, id).toBeCloseTo(54, 6);
      expect(nose.depth / scale / MM, id).toBeGreaterThan(92);
      expect(nose.depth / scale / MM, id).toBeLessThan(96);
    }
  });

  it("turn the mouth down into the throat, opening as wide as the figure's mouth and 45.7 mm", () => {
    const shut = figure({ age: 25 }, 0).channels.mouth;
    const open = figure({ age: 25 }, 1);
    const mouth = open.channels.mouth;
    if (!shut || !mouth) throw new Error("no mouth");
    const scale = head(open.marks).span / ADULT_EAR_SPAN;
    expect(placeIn(shut, along(shut.origin, shut.inward, 0.01)).inside).toBe(false);
    expect(placeIn(mouth, along(mouth.origin, mouth.inward, 0.01)).inside).toBe(true);
    const width = length(
      sub(open.marks["mouth-corner.L"].position, open.marks["mouth-corner.R"].position),
    );
    expect(2 * (mouth.halfSize(0)[0] ?? 0)).toBeCloseTo(width, 6);
    expect((2 * (mouth.halfSize(0)[1] ?? 0)) / scale).toBeCloseTo(0.0457, 6);
    expect(turnOverall(mouth)).toBeGreaterThan(85);
    expect(turnOverall(mouth)).toBeLessThan(95);
    // Down, into the throat, at its end.
    const end = mouth.sections.at(-1) as (typeof mouth.sections)[0];
    expect(degrees(end.normal, head(open.marks).up)).toBeGreaterThan(150);
    expect(mouth.depth / scale / MM).toBeGreaterThan(90);
    expect(mouth.depth / scale / MM).toBeLessThan(95);
  });

  it("scale with the head: a child's are an adult's, shrunk by its head's width", () => {
    const adult = figure({ age: 25 });
    const child = figure({ age: 6 });
    const ratio = head(child.marks).span / head(adult.marks).span;
    expect(ratio).toBeLessThan(0.95);
    for (const id of ["ear-canal.L", "nostril.R"] as const) {
      const a = adult.channels[id];
      const c = child.channels[id];
      if (!a || !c) throw new Error(id);
      expect(c.depth / a.depth, id).toBeCloseTo(ratio, 9);
      a.sections.forEach((s, i) => {
        const t = c.sections[i] as typeof s;
        expect(t.halfAcross / s.halfAcross, `${id} ${i}`).toBeCloseTo(ratio, 9);
        expect(t.depth / (s.depth || 1), `${id} ${i}`).toBeCloseTo(i === 0 ? 0 : ratio, 9);
      });
      const knots = CHANNELS.auditory.knots.length;
      if (id === "ear-canal.L") expect(turnAt(c, knots, 1)).toBeCloseTo(turnAt(a, knots, 1), 6);
    }
  });

  it("turn with the head as the figure poses, keeping their shape", () => {
    const rest = figure({ age: 25 }).channels["ear-canal.R"];
    const posed = figure({ age: 25 }, 0, "overhead").channels["ear-canal.R"];
    if (!rest || !posed) throw new Error("no ear canal");
    expect(posed.depth).toBeCloseTo(rest.depth, 4);
    const knots = CHANNELS.auditory.knots.length;
    expect(turnAt(posed, knots, 1)).toBeCloseTo(turnAt(rest, knots, 1), 4);
  });

  it("hold a point inside each channel along its path, and none past its wall", () => {
    const { channels } = figure({ age: 25 }, 1);
    for (const [id, c] of Object.entries(channels as Record<string, Channel>)) {
      for (const i of [3, 12, 21]) {
        const s = c.sections[i];
        if (!s) throw new Error(`${id} ${i}`);
        expect(placeIn(c, s.centre).inside, `${id} ${i} centre`).toBe(true);
        expect(placeIn(c, s.centre).depth, `${id} ${i}`).toBeCloseTo(s.depth, 6);
        expect(placeIn(c, along(s.centre, s.across, s.halfAcross * 1.1)).inside, `${id} ${i}`).toBe(
          false,
        );
      }
    }
    const ids: ChannelId[] = ["auditory", "nasal", "oral"];
    expect(ids.every((id) => CHANNELS[id].knots[0]?.at.every((x) => x === 0))).toBe(true);
  });
});
