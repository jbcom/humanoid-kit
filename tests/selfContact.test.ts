/**
 * Self-contact, slice 1 (docs/SELF-CONTACT.md, #117): a figure's own finger pad
 * solved onto a site of its own body, on real evaluated figures of four builds,
 * standing and seated. Every distance is measured on the renderer's CPU reference
 * (`surfacePoser`, folds included) through the landmark frames the affordance handle
 * reads, never from the solver's own report.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { beforeAll, describe, expect, it } from "vitest";
import { animationsPack } from "../packs/animations/index.js";
import { affordances, CORE_AFFORDANCES } from "../src/affordance/registry.ts";
import { sampleClip } from "../src/animation/clip.ts";
import { loadAnimationLibrary } from "../src/animation/library.ts";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { PENETRATION_LIMIT, vertexParts } from "../src/foundation/invariants.ts";
import { landmarkAnchors, landmarks } from "../src/foundation/landmarks.ts";
import { surfacePoser } from "../src/foundation/posed.ts";
import { audienceOf, type InteractionDefinition } from "../src/interaction/definition.ts";
import { createInteractions } from "../src/interaction/runtime.ts";
import {
  HAND_SHAPES,
  handShapeRotations,
  SELF_CONTACT_SITES,
  type SiteContactFigure,
  type SiteContactReport,
  solveSiteContact,
} from "../src/interaction/siteContact.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { skinOfEvaluation } from "../src/model/reservoirSkin.ts";
import { createPresenceRegistry } from "../src/presence/presence.ts";
import { AgePolicyError, isAdult } from "../src/recipe/agePolicy.ts";
import { createRecipe, type Recipe } from "../src/recipe/recipe.ts";
import { heaviestBone } from "../src/rig/influences.ts";
import { bodyPoseRotations, restBones, rigData } from "../src/rig/pose.ts";
import { adultPackData, bodyPackData } from "./fixtures.ts";
import { figure } from "./interactionHarness.ts";

const model = new HumanoidModel(parseHumanoidAssets(bodyPackData(), adultPackData()), {
  subdivision: 1,
});
const rig = rigData(model.assets);
const BONES = rig.bones.length;

/** The figures of the slice: a child, a slim woman, a heavy man and an elder. */
const BODIES: Record<string, Recipe> = {
  child: createRecipe({ macros: { age: 8, gender: 0.5 } }),
  "slim woman": createRecipe({ macros: { age: 30, gender: 0, weight: 0.2 } }),
  "heavy man": createRecipe({ macros: { age: 30, gender: 1, weight: 1 } }),
  elder: createRecipe({ macros: { age: 85, gender: 0 } }),
};
/** A flat chest selected independently of the figure's gender macro. */
const FLAT_CHEST = createRecipe({
  macros: { age: 30, gender: 0, weight: 0, muscle: 0 },
  regionalMacros: {
    breastL: { breastPresence: 0, breastSize: 0 },
    breastR: { breastPresence: 0, breastSize: 0 },
  },
});

/** All-ages sites, each with the hand that reaches it. */
const CONTACTS = [
  ["finger-pad-2.R", "nose-tip"],
  ["finger-pad-2.R", "chin"],
  ["finger-pad-2.R", "crown"],
  ["finger-pad-2.R", "ear-lobe.R"],
  ["finger-pad-2.L", "ear-lobe.L"],
  ["finger-pad-2.R", "sternum-notch"],
  ["finger-pad-2.R", "nipple.L"],
  ["finger-pad-2.R", "navel"],
] as const;

/** Knees are reachable from the seated source posture only (R7). */
const SEATED_CONTACTS = [
  ["finger-pad-2.R", "kneecap.R"],
  ["finger-pad-2.L", "kneecap.L"],
] as const;

/** How close the pad's skin must come to the site's (docs/SELF-CONTACT.md, R3). */
const GAP = 0.005;

let standing: Float32Array;
let seated: Float32Array;
beforeAll(async () => {
  const library = await loadAnimationLibrary(animationsPack);
  const clip = await library.load("idle1", rig.bones);
  standing = sampleClip(clip, 0.4, new Float32Array(BONES * 4));
  seated = Float32Array.from(bodyPoseRotations(rig, "seated"));
});
const POSTURES = { standing: () => standing, seated: () => seated };

/** The figure as the constraint reads it: its evaluated rest surface, weights, skeleton and landmarks. */
function figureOf(recipe: Recipe): SiteContactFigure {
  const ev = model.evaluate(recipe);
  const topology = ev.surface === "adult" ? model.adultSurface() : model.topology().body;
  if (!topology) throw new Error("an adult evaluation without the adult surface");
  const { skinIndex, skinWeight } = skinOfEvaluation(ev, topology);
  return {
    adult: isAdult(recipe),
    generation: ev,
    index: topology.index,
    restBones: restBones(model.assets, Float32Array.from(ev.control)),
    rest: Float32Array.from(ev.positions),
    restNormals: Float32Array.from(ev.normals),
    skinIndex,
    skinWeight,
    anchors: landmarkAnchors(model, ev.surface),
  };
}

const dist = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  Math.hypot(
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  );

/**
 * The touching hand's vertices inside the rest of the body by more than the
 * foundation's limit: a ray from each, along the site's outward normal and that
 * normal tilted, crosses the body (without that arm) an odd number of times both
 * ways, and the nearest such skin is past `PENETRATION_LIMIT`.
 */
function handInside(
  posed: ReturnType<ReturnType<typeof surfacePoser>>,
  side: "L" | "R",
  outward: readonly number[],
): number {
  const parts = vertexParts(posed);
  const arm = new Set([`hand.${side}`, `forearm.${side}`, `upperarm.${side}`]);
  const kept: number[] = [];
  for (let t = 0; t < posed.index.length; t += 3) {
    const a = posed.index[t] as number;
    const b = posed.index[t + 1] as number;
    const c = posed.index[t + 2] as number;
    if (arm.has(parts[a] as string) || arm.has(parts[b] as string) || arm.has(parts[c] as string))
      continue;
    kept.push(a, b, c);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(posed.positions, 3));
  geometry.setIndex(new BufferAttribute(Uint32Array.from(kept), 1));
  const bvh = new MeshBVH(geometry, { verbose: false });
  const n = new Vector3(outward[0], outward[1], outward[2]).normalize();
  const tilt = new Vector3()
    .crossVectors(n, Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0))
    .normalize();
  const ray = new Ray();
  const p = new Vector3();
  const hit = { point: new Vector3(), distance: 0, faceIndex: 0 };
  let inside = 0;
  for (let v = 0; v < parts.length; v++) {
    if (parts[v] !== `hand.${side}`) continue;
    p.set(
      posed.positions[v * 3] as number,
      posed.positions[v * 3 + 1] as number,
      posed.positions[v * 3 + 2] as number,
    );
    ray.origin.copy(p);
    ray.direction.copy(n);
    if (bvh.raycast(ray, DoubleSide).length % 2 === 0) continue;
    ray.direction.copy(n).addScaledVector(tilt, 0.5).normalize();
    if (bvh.raycast(ray, DoubleSide).length % 2 === 0) continue;
    bvh.closestPointToPoint(p, hit);
    if (hit.distance > PENETRATION_LIMIT) inside++;
  }
  geometry.dispose();
  return inside;
}

/** Solves one contact on a figure and measures it on the posed CPU reference. */
function touch(
  recipe: Recipe,
  source: Float32Array,
  effector: string,
  site: string,
  standoff?: number,
  shape: keyof typeof HAND_SHAPES = "point",
): { report: SiteContactReport; gap: number; inside: number; out: Float32Array } {
  const figure = figureOf(recipe);
  const out = new Float32Array(BONES * 4);
  const report = solveSiteContact({
    figure,
    source,
    effector,
    site,
    shape,
    ...(standoff === undefined ? {} : { standoff }),
    out,
  });
  const posed = surfacePoser(model, recipe)(out);
  const frames = landmarks(model, posed) as Record<
    string,
    { position: readonly number[]; normal: readonly number[] }
  >;
  const pad = frames[effector];
  const at = frames[site];
  if (!pad || !at) throw new Error(`no landmark ${effector} or ${site}`);
  const side = effector.endsWith(".L") ? "L" : "R";
  return {
    report,
    gap: dist(pad.position, at.position),
    inside: handInside(posed, side, at.normal),
    out,
  };
}

describe("self-contact: a finger pad held on a site of the figure's own body", {
  timeout: 900_000,
}, () => {
  for (const [body, recipe] of Object.entries(BODIES))
    for (const [posture, source, contacts] of [
      ["standing", POSTURES.standing, CONTACTS],
      ["seated", POSTURES.seated, [...CONTACTS, ...SEATED_CONTACTS]],
    ] as const)
      for (const [effector, site] of contacts)
        it(`${body}, ${posture}: ${effector} on ${site}`, () => {
          const { report, gap, inside } = touch(recipe, source(), effector, site);
          expect(report.status, report.reason).toBe("reached");
          expect(gap, "pad to site, metres, on the rendered surface").toBeLessThan(GAP);
          expect(inside, "hand vertices inside the body").toBe(0);
        });

  /**
   * Minor ear contacts close. Broad support contacts report the primary-palm
   * support that reaches the site, but remain red until the full hand clears.
   */
  for (const [name, recipe, effector, site, shape, expected] of [
    ["child right ear pinch", BODIES.child, "finger-pad-1.R", "ear-lobe.R", "pinch", "reached"],
    ["child left ear pinch", BODIES.child, "finger-pad-1.L", "ear-lobe.L", "pinch", "reached"],
    [
      "flat hand at sternum",
      BODIES["slim woman"],
      "palm.R",
      "sternum-notch",
      "flat",
      "body-collision",
    ],
    [
      "flat hand at source-flat sternum",
      FLAT_CHEST,
      "palm.R",
      "sternum-notch",
      "flat",
      "body-collision",
    ],
    ["flat hand on source-flat chest", FLAT_CHEST, "palm.R", "nipple.R", "flat", "reached"],
    ["cupped hand at heavy navel", BODIES["heavy man"], "palm.R", "navel", "cup", "reached"],
  ] as const)
    it(`reports ${name} on the actual contact patch after the final arm solve`, () => {
      const { report, gap, inside, out } = touch(
        recipe as Recipe,
        standing,
        effector,
        site,
        undefined,
        shape,
      );
      const broad = shape === "flat" || shape === "cup";
      if (!broad) {
        expect(report.status, report.reason).toBe("reached");
        expect(gap, "pad to site, metres, on the rendered surface").toBeLessThan(GAP);
        expect(inside, "hand vertices inside the body").toBe(0);
        return;
      }
      expect(report.status, report.reason).toBe(expected === "reached" ? "reached" : "unreached");
      if (expected === "body-collision") expect(report.reason).toBe("body-collision");
      const contact = report.contact;
      expect(contact?.domain, "broad contact domain").toBe("volar-palm-support");
      if (!contact) throw new Error("missing broad contact support");
      expect(contact.vertex, "support differs from stable palm centre").not.toBe(
        contact.centreVertex,
      );
      const figure = figureOf(recipe as Recipe);
      const bone =
        figure.restBones.names[heaviestBone(figure.skinIndex, figure.skinWeight, contact.vertex)];
      expect(bone, "support is primary metacarpal skin").toMatch(/^metacarpal[1-4]\.R$/);
      const posed = surfacePoser(model, recipe as Recipe)(out);
      const frames = landmarks(model, posed) as Record<
        string,
        { position: readonly number[]; normal: readonly number[] }
      >;
      const siteFrame = frames[site];
      if (!siteFrame) throw new Error(`missing site frame: ${site}`);
      const point: [number, number, number] = [
        posed.positions[contact.vertex * 3] as number,
        posed.positions[contact.vertex * 3 + 1] as number,
        posed.positions[contact.vertex * 3 + 2] as number,
      ];
      const normal: [number, number, number] = [
        posed.normals[contact.vertex * 3] as number,
        posed.normals[contact.vertex * 3 + 1] as number,
        posed.normals[contact.vertex * 3 + 2] as number,
      ];
      const centre: [number, number, number] = [
        posed.positions[contact.centreVertex * 3] as number,
        posed.positions[contact.centreVertex * 3 + 1] as number,
        posed.positions[contact.centreVertex * 3 + 2] as number,
      ];
      expect(
        dist(point, contact.position),
        "reported support is the posed source vertex",
      ).toBeLessThan(1e-6);
      expect(dist(point, siteFrame.position), "support to site, metres").toBeLessThan(GAP);
      expect(
        normal[0] * contact.normal[0] +
          normal[1] * contact.normal[1] +
          normal[2] * contact.normal[2],
        "reported support normal",
      ).toBeGreaterThan(0.999);
      expect(contact.centreToContact).toEqual([
        point[0] - centre[0],
        point[1] - centre[1],
        point[2] - centre[2],
      ]);
      if (expected === "reached") expect(inside, "full hand is clear").toBe(0);
      else expect(inside, "strict full-hand collision remains red").toBeGreaterThan(0);
    });

  it("sees a finger pushed into the face: the penetration check is not vacuous", () => {
    const { inside } = touch(
      BODIES["slim woman"] as Recipe,
      standing,
      "finger-pad-2.R",
      "nose-tip",
      -0.01,
    );
    expect(inside).toBeGreaterThan(0);
  });

  it("reports a site out of reach, with its gap, and does not stretch the arm", () => {
    const { report, gap } = touch(
      BODIES["slim woman"] as Recipe,
      standing,
      "finger-pad-2.R",
      "sole.L",
    );
    expect(report.status).toBe("unreached");
    expect(report.reason).toBeTruthy();
    expect(report.gap).toBeGreaterThan(0.1);
    expect(gap).toBeCloseTo(report.gap, 2);
  });

  it("is the source pose byte for byte at weight 0", () => {
    const figure = figureOf(BODIES["heavy man"] as Recipe);
    const out = new Float32Array(BONES * 4);
    solveSiteContact({
      figure,
      source: standing,
      effector: "finger-pad-2.R",
      site: "nose-tip",
      shape: "point",
      weight: 0,
      out,
    });
    expect([...out]).toEqual([...standing]);
  });
});

describe("what a site contact accepts", () => {
  /** A weight-0 solve: every check runs, no arm is solved. */
  const probe = (subject: SiteContactFigure, effector: string, site: string) => () =>
    solveSiteContact({
      figure: subject,
      source: standing,
      effector,
      site,
      weight: 0,
      out: new Float32Array(BONES * 4),
    });

  it("touches with a finger pad, the palm or the hand, and nothing else", () => {
    const woman = figureOf(BODIES["slim woman"] as Recipe);
    for (const effector of ["finger-pad-1.L", "finger-pad-5.R", "palm.L", "hand.R"])
      expect(probe(woman, effector, "nose-tip"), effector).not.toThrow();
    for (const effector of ["nipple.L", "ear-lobe.R", "wrist.L", "finger-pad-6.R", "hand"])
      expect(probe(woman, effector, "nose-tip"), effector).toThrow(/not a point of one hand/);
  });

  it("refuses a minor a site the registry does not say is all-ages", () => {
    const child = figureOf(BODIES.child as Recipe);
    expect(probe(child, "finger-pad-2.R", "pubic-point")).toThrow(AgePolicyError);
    // The same site on an adult is solved: the refusal is the age's, not the site's.
    expect(probe(figureOf(BODIES.elder as Recipe), "finger-pad-2.R", "pubic-point")).not.toThrow();
  });

  it("lets a minor touch every all-ages site, the nipples among them", () => {
    const child = figureOf(BODIES.child as Recipe);
    for (const site of SELF_CONTACT_SITES)
      expect(probe(child, "finger-pad-2.R", site), site).not.toThrow();
    // A finger to the lips, and one hand on the other: everyday at any age.
    for (const site of ["upper-lip", "lower-lip", "palm.L"])
      expect(probe(child, "finger-pad-2.R", site), site).not.toThrow();
  });

  it("treats a figure that does not say it is adult as a minor", () => {
    const { adult: _adult, ...unsaid } = figureOf(BODIES.elder as Recipe);
    expect(probe(unsaid as SiteContactFigure, "finger-pad-2.R", "pubic-point")).toThrow(
      AgePolicyError,
    );
  });
});

describe("hand shapes", () => {
  it("offers the contact shapes specified for self contact", () => {
    expect(Object.keys(HAND_SHAPES).sort()).toEqual([
      "claw",
      "cup",
      "fist",
      "flat",
      "pinch",
      "point",
    ]);
  });

  it("moves only the fingers of its own hand", () => {
    for (const shape of Object.keys(HAND_SHAPES) as (keyof typeof HAND_SHAPES)[])
      for (const side of ["L", "R"] as const) {
        const out = handShapeRotations(rig, standing, shape, side, new Float32Array(BONES * 4));
        rig.bones.forEach((name, b) => {
          const own = new RegExp(`^finger[1-5]-[1-3]\\.${side}$`).test(name);
          const moved = [0, 1, 2, 3].some(
            (k) => Math.abs((out[b * 4 + k] as number) - (standing[b * 4 + k] as number)) > 1e-7,
          );
          if (!own) expect(moved, `${shape} ${side} moved ${name}`).toBe(false);
        });
      }
  });

  it("points the index finger: its pad leads, the other fingers curl behind it", () => {
    const recipe = BODIES["slim woman"] as Recipe;
    const out = handShapeRotations(rig, standing, "point", "R", new Float32Array(BONES * 4));
    const frames = landmarks(model, surfacePoser(model, recipe)(out)) as Record<
      string,
      { position: readonly number[] }
    >;
    const wrist = frames["wrist.R"]?.position as number[];
    const index = dist(frames["finger-pad-2.R"]?.position as number[], wrist);
    for (const f of [3, 4, 5])
      expect(dist(frames[`finger-pad-${f}.R`]?.position as number[], wrist)).toBeLessThan(
        index * 0.8,
      );
  });

  it("puts the thumb opposite the index for a pinch", () => {
    const recipe = BODIES["slim woman"] as Recipe;
    const out = handShapeRotations(rig, standing, "pinch", "R", new Float32Array(BONES * 4));
    const frames = landmarks(model, surfacePoser(model, recipe)(out)) as Record<
      string,
      { position: readonly number[] }
    >;
    expect(
      dist(
        frames["finger-pad-1.R"]?.position as number[],
        frames["finger-pad-2.R"]?.position as number[],
      ),
    ).toBeLessThan(0.04);
  });

  it("keeps a flat hand open and folds a fist into the palm", () => {
    const recipe = BODIES["slim woman"] as Recipe;
    const pads = (shape: keyof typeof HAND_SHAPES) => {
      const out = handShapeRotations(rig, standing, shape, "R", new Float32Array(BONES * 4));
      const frames = landmarks(model, surfacePoser(model, recipe)(out)) as Record<
        string,
        { position: readonly number[] }
      >;
      const wrist = frames["wrist.R"]?.position as number[];
      return [1, 2, 3, 4, 5].map((finger) =>
        dist(frames[`finger-pad-${finger}.R`]?.position as number[], wrist),
      );
    };
    const flat = pads("flat");
    const fist = pads("fist");
    // The support-palm thumb rests adducted, while the four long digits remain open.
    for (let finger = 1; finger < flat.length; finger++) {
      expect(flat[finger]).toBeGreaterThan(0.1);
      expect(fist[finger]).toBeLessThan(flat[finger] as number);
    }
  });
});

describe("self-contact and the age policy", () => {
  const fidget = (site: string): InteractionDefinition => ({
    id: `self.${site}`,
    tags: ["idle.fidget"],
    audience: "all",
    roles: [
      {
        name: "self",
        takes: "figure",
        affordances: ["finger-pad-2.R", site],
        uses: ["arm.R", "hand.R"] as never,
        track: { act: { clip: "idle1", loop: true } },
      },
    ],
    contacts: [{ name: "touch", a: "self:finger-pad-2.R", b: `self:${site}`, during: ["act"] }],
    alignSeconds: 0,
    releaseSeconds: 0.3,
  });

  it("registers every all-ages site as a contact a child has", () => {
    const child = affordances(BODIES.child as Recipe);
    for (const site of SELF_CONTACT_SITES) {
      const entry = CORE_AFFORDANCES.find((a) => a.id === site);
      expect(entry, site).toBeDefined();
      expect(entry?.adult, site).toBe(false);
      expect(
        child.some((a) => a.id === site),
        site,
      ).toBe(true);
    }
  });

  it("keeps a child's fidget for all audiences", () => {
    for (const site of SELF_CONTACT_SITES) expect(audienceOf(fidget(site)), site).toBe("all");
  });

  it("makes a contact naming an adult pack site adult", () => {
    expect(audienceOf(fidget("introitus"))).toBe("adult");
  });

  it("names the nipples and kneecaps among the all-ages sites", () => {
    for (const site of ["nipple.L", "nipple.R", "kneecap.L", "kneecap.R"])
      expect(SELF_CONTACT_SITES as readonly string[], site).toContain(site);
  });

  /** A runtime with a child (`kid`) and an adult (`mum`) published. */
  const session = () => {
    const presence = createPresenceRegistry();
    const runtime = createInteractions(presence, { seed: 1, clipLength: () => 1 });
    presence.set(figure("kid", false));
    presence.set(figure("mum", true, 1));
    return { presence, runtime };
  };

  it("refuses a child an adult pack site's fidget at proposal", () => {
    const { runtime } = session();
    runtime.define([fidget("introitus")]);
    expect(() => runtime.propose("self.introitus", { self: "kid" })).toThrow(AgePolicyError);
  });

  it("runs a child's own nipple fidget: the site is not the adult line", () => {
    const { runtime } = session();
    runtime.define([fidget("nipple.L")]);
    expect(audienceOf(fidget("nipple.L"))).toBe("all");
    expect(runtime.propose("self.nipple.L", { self: "kid" }).audience).toBe("all");
  });

  it("keeps nursing for all audiences: an infant's mouth at its mother's nipple", () => {
    const nursing: InteractionDefinition = {
      id: "nurse",
      tags: ["care.nurse"],
      audience: "all",
      roles: [
        {
          name: "mother",
          takes: "figure",
          affordances: ["nipple.L", "hand.L"],
          track: { act: { clip: "idle1", loop: true } },
        },
        {
          name: "infant",
          takes: "figure",
          affordances: ["mouth", "hand.R"],
          track: { act: { clip: "idle1", loop: true } },
        },
      ],
      contacts: [
        { name: "latch", a: "infant:mouth", b: "mother:nipple.L", during: ["act"] },
        { name: "hold", a: "infant:hand.R", b: "mother:nipple.L", during: ["act"] },
      ],
    };
    expect(audienceOf(nursing)).toBe("all");
    const { runtime } = session();
    runtime.define([nursing]);
    expect(runtime.propose("nurse", { mother: "mum", infant: "kid" }).audience).toBe("all");
  });
});
