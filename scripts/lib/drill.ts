/**
 * The arms the 1860s drill clips handle (`scripts/clips/`), and where each count
 * of each clip holds them: one rigid musket or colour staff per clip, placed by
 * one anchor that is not the hand being judged, and the contacts the count
 * requires of the body against it. The tests (`tests/drill.test.ts`), the
 * probe (`scripts/research/drill-probe.ts`) and the review sheets' overlay
 * (`playground/src/DrillProp.tsx`) all read the same placements, so what a
 * sheet draws is what a test measured.
 *
 * The sources, quoted where a number comes from them:
 * - Hardee, Rifle and Light Infantry Tactics (Lippincott, 1861), School of the
 *   Soldier, Part II: shoulder arms (no. 145), load in nine times (nos.
 *   156-170), ready, aim and fire (nos. 171-177). Casey's Infantry Tactics
 *   (1862) carries the same text for the loading.
 * - The rifle-musket, model 1861: 56 in overall, a 40 in barrel, three bands.
 *   The stations along it below are measured from the heel of the butt.
 * - The colours: Revised Regulations for the Army (1861), par. 1436, "the
 *   length of the pike, including the spear and ferrule, to be nine feet ten
 *   inches".
 *
 * The figure's frame throughout: metres, +x the figure's left, +y up, +z
 * forward, the ground at y = 0 as the renderer grounds the figure.
 */
import type { FrameOut, LandmarkId } from "../../src/foundation/landmarks.ts";

export type Vec3 = [number, number, number];
export type Side = "L" | "R";

/** Reads a landmark's frame on the posed, grounded figure (`HumanoidAffordances.landmark`, `landmarks`). */
export type Marks = (id: LandmarkId) => Readonly<FrameOut>;

const IN = 0.0254;

/** The rifle-musket of 1861: its length and the stations along it, metres from the heel of the butt. */
export const MUSKET = {
  length: 56 * IN,
  /** The small of the stock, where the right hand grasps it to fire. */
  smallOfStock: 10.5 * IN,
  /** The trigger guard, which the right hand's thumb and forefinger embrace at shoulder arms. */
  guard: 13 * IN,
  /** The breech, where the 40 in barrel starts, and the lock's nipple beside it. */
  breech: 16 * IN,
  /** The lower band, where the left hand holds the piece at ready, aim and prime. */
  lowerBand: 30 * IN,
  /** The upper band, three inches behind the muzzle. */
  upperBand: 53 * IN,
  /** The stock's radius at the grip and the barrel's, as drawn. */
  stockRadius: 0.024,
  barrelRadius: 0.011,
} as const;

/** The regimental colour's pike: 9 ft 10 in with spear and ferrule. */
export const COLOUR_STAFF = { length: 118 * IN, radius: 0.016 } as const;

/**
 * How far in front of the palm's skin the axis of what the hand closes round
 * lies: the radius of the stock less what the palm's flesh gives. A held piece's
 * axis is within `GRIP_REACH` of this point.
 */
export const GRIP_DEPTH = 0.022;
/** How far a gripping hand's grip point may be from the axis of the piece it holds. */
export const GRIP_REACH = 0.035;

/** A held piece, as placed for a count: its heel (the butt, the staff's ferrule), its direction and length. */
export interface Piece {
  kind: "musket" | "staff";
  heel: Vec3;
  /** Unit, from the heel toward the muzzle or the spear. */
  axis: Vec3;
  length: number;
}

/**
 * How a count places the piece, from one thing the count fixes:
 * - `grounded`: upright, the butt on the ground below the hand's grip (load).
 * - `held`: the hand holds `station` and the piece points to the other hand's
 *   grip, whose station is then what the count judges (ready, aim, prime, charge).
 * - `upright`: the hand holds `station` and the piece stands upright (shoulder
 *   arms, the colours).
 */
export type Placement =
  | { by: "grounded"; hand: Side }
  | { by: "held"; hand: Side; station: number }
  | { by: "upright"; hand: Side; station: number };

/** A hand on the piece: its grip within `GRIP_REACH` of the axis, between two stations. */
export interface Hold {
  hand: Side;
  between: [number, number];
}

/**
 * A point on the piece (a station, metres from the heel) within `within` metres
 * of a landmark moved by `offset`; `axis` measures only height ("y") or only
 * the horizontal distance ("xz").
 */
export interface Touch {
  station: number;
  near: LandmarkId;
  offset?: Vec3;
  within: number;
  axis?: "y" | "xz";
  /** What the source says, for the failure message. */
  says: string;
}

/** A landmark within `within` of the piece's axis (a cheek on the stock, a shoulder against the piece). */
export interface Against {
  mark: LandmarkId;
  within: number;
  says: string;
}

/** A hand's digit at a point that is not on the piece: the cartridge at the mouth. */
export interface Reach {
  mark: LandmarkId;
  to: LandmarkId | "muzzle";
  within: number;
  says: string;
}

/** One count of a clip: the key it is held at, and what it requires. */
export interface Count {
  /** The clip's key time, seconds: the count is judged there. */
  t: number;
  name: string;
  place: Placement;
  holds: Hold[];
  touches?: Touch[];
  against?: Against[];
  reaches?: Reach[];
}

export interface Drill {
  clip: string;
  piece: Piece["kind"];
  counts: Count[];
}

const M = MUSKET;
const SHOULDER_ARMS = (t: number): Count => ({
  t,
  name: "shoulder arms",
  // No. 145: "the piece in the right hand, the barrel nearly vertical and resting in the
  // hollow of the shoulder, the guard to the front, the arm hanging nearly at its full
  // length near the body; the thumb and forefinger embracing the guard".
  place: { by: "upright", hand: "R", station: M.guard },
  holds: [{ hand: "R", between: [M.smallOfStock, M.breech] }],
  against: [
    { mark: "shoulder.R", within: 0.12, says: "the barrel rests in the hollow of the shoulder" },
  ],
});

/**
 * The drill clips' counts. Each count's `t` is one of its clip's keys
 * (`tests/drill.test.ts` holds them to it), so a count is judged where the
 * clip holds its position rather than between two.
 */
export const DRILLS: readonly Drill[] = [
  {
    clip: "musket_load",
    piece: "musket",
    counts: [
      {
        t: 0,
        name: "load",
        // No. 156: "place the butt between the feet, the barrel to the front; seize it with
        // the left hand near the muzzle, which should be three inches from the body; carry
        // the right hand to the cartridge box".
        place: { by: "grounded", hand: "L" },
        holds: [{ hand: "L", between: [M.length - 0.3, M.length - 0.02] }],
        touches: [
          {
            station: 0,
            near: "ankle.L",
            offset: [-0.1, 0, 0.1],
            within: 0.14,
            axis: "xz",
            says: "the butt between the feet",
          },
          {
            station: M.length,
            near: "sternum-notch",
            offset: [0, 0, 0.08],
            within: 0.12,
            axis: "xz",
            says: "the muzzle three inches from the body",
          },
        ],
      },
      {
        t: 0.6,
        name: "handle cartridge",
        // No. 157: "seize the cartridge with the thumb and next two fingers, and place it
        // between the teeth".
        place: { by: "grounded", hand: "L" },
        holds: [{ hand: "L", between: [M.length - 0.3, M.length - 0.02] }],
        reaches: [
          {
            mark: "finger-pad-1.R",
            to: "upper-lip",
            within: 0.06,
            says: "the cartridge between the teeth",
          },
        ],
      },
      {
        t: 1.2,
        name: "charge cartridge",
        // Nos. 158-159: the torn cartridge "in front of and near the muzzle", the powder
        // emptied into the barrel, "the elbows near the body".
        place: { by: "grounded", hand: "L" },
        holds: [{ hand: "L", between: [M.length - 0.3, M.length - 0.02] }],
        reaches: [
          {
            mark: "finger-pad-1.R",
            to: "muzzle",
            within: 0.07,
            says: "the cartridge at the muzzle",
          },
        ],
      },
      {
        t: 1.8,
        name: "draw rammer",
        // Nos. 160-161: the rammer drawn "by extending the right arm", then cleared, "the
        // rammer in the prolongation of the pipes".
        place: { by: "grounded", hand: "L" },
        holds: [
          { hand: "L", between: [M.length - 0.3, M.length - 0.02] },
          { hand: "R", between: [M.length + 0.2, M.length + 0.75] },
        ],
      },
      {
        t: 2.2,
        name: "ram cartridge",
        // No. 163: the rammer held "at the small end", the ball pressed home, "the elbows
        // near the body".
        place: { by: "grounded", hand: "L" },
        holds: [
          { hand: "L", between: [M.length - 0.3, M.length - 0.02] },
          { hand: "R", between: [M.length + 0.02, M.length + 0.4] },
        ],
      },
      {
        t: 3.3,
        name: "return rammer",
        // Nos. 164-166: drawn half out again, cleared, turned and put back in the pipes.
        place: { by: "grounded", hand: "L" },
        holds: [
          { hand: "L", between: [M.length - 0.3, M.length - 0.02] },
          { hand: "R", between: [M.length + 0.2, M.length + 0.75] },
        ],
      },
      {
        t: 3.8,
        name: "prime",
        // No. 167: "with the left hand raise the piece till the hand is as high as the eye,
        // grasp the small of the stock with the right hand ... slip the left hand down to
        // the lower band ... bring the piece to the right side, the butt below the right
        // fore-arm, the small of the stock against the body and two inches below the right
        // breast, the barrel upwards, the muzzle on a level with the eye".
        place: { by: "held", hand: "R", station: M.smallOfStock },
        holds: [{ hand: "L", between: [M.lowerBand - 0.15, M.lowerBand + 0.12] }],
        touches: [
          {
            station: M.smallOfStock,
            near: "nipple.R",
            offset: [0, -0.05, 0.04],
            within: 0.1,
            says: "the small of the stock two inches below the right breast",
          },
          {
            station: M.length,
            near: "nose-tip",
            within: 0.15,
            axis: "y",
            says: "the muzzle on a level with the eye",
          },
        ],
      },
      { ...SHOULDER_ARMS(4.6), name: "shoulder" },
    ],
  },
  {
    clip: "musket_fire",
    piece: "musket",
    counts: [
      SHOULDER_ARMS(0),
      {
        t: 0.6,
        name: "ready",
        // No. 172: "the butt below the right fore-arm, the small of the stock against the
        // body and two inches below the right breast, the muzzle as high as the eye, the left
        // elbow against the side".
        place: { by: "held", hand: "R", station: M.smallOfStock },
        holds: [{ hand: "L", between: [M.lowerBand - 0.15, M.lowerBand + 0.12] }],
        touches: [
          {
            station: M.smallOfStock,
            near: "nipple.R",
            offset: [0, -0.05, 0.04],
            within: 0.1,
            says: "the small of the stock two inches below the right breast",
          },
          {
            station: M.length,
            near: "nose-tip",
            within: 0.15,
            axis: "y",
            says: "the muzzle as high as the eye",
          },
        ],
      },
      {
        t: 1.2,
        name: "aim",
        // No. 174: "support the butt against the right shoulder; the left elbow down, the
        // right as high as the shoulder; incline the head upon the butt, so that the right
        // eye may perceive quickly the notch of the hausse, the front sight".
        place: { by: "held", hand: "R", station: M.smallOfStock },
        holds: [{ hand: "L", between: [M.lowerBand - 0.15, M.lowerBand + 0.15] }],
        touches: [
          {
            station: 0.02,
            near: "shoulder.R",
            within: 0.1,
            says: "the butt against the right shoulder",
          },
        ],
        against: [{ mark: "nose-tip", within: 0.12, says: "the head inclined upon the butt" }],
      },
      {
        t: 1.6,
        name: "fire",
        // No. 177: "fire, without lowering or turning the head, and remain in this position".
        place: { by: "held", hand: "R", station: M.smallOfStock },
        holds: [{ hand: "L", between: [M.lowerBand - 0.15, M.lowerBand + 0.15] }],
        touches: [
          {
            station: 0.02,
            near: "shoulder.R",
            within: 0.1,
            says: "the butt against the right shoulder",
          },
        ],
        against: [{ mark: "nose-tip", within: 0.12, says: "the head inclined upon the butt" }],
      },
      SHOULDER_ARMS(3),
    ],
  },
  {
    clip: "march_quick",
    piece: "musket",
    counts: [0, 0.275, 0.55, 0.825].map(SHOULDER_ARMS),
  },
  {
    clip: "charge_advance",
    piece: "musket",
    // Charge bayonet: the left hand forward under the barrel, the right hand at the small of
    // the stock against the right hip, the point of the bayonet as high as the eye.
    counts: [0, 0.1833333333333333, 0.3666666666666667, 0.55].map((t) => ({
      t,
      name: "charge bayonet",
      place: { by: "held", hand: "R", station: M.smallOfStock } as const,
      holds: [
        { hand: "L" as const, between: [M.lowerBand - 0.2, M.lowerBand + 0.2] as [number, number] },
      ],
      touches: [
        {
          station: M.smallOfStock,
          near: "hip.R" as const,
          within: 0.2,
          says: "the right hand at the small of the stock by the right hip",
        },
      ],
    })),
  },
  {
    clip: "colour_bearer",
    piece: "staff",
    // The colours carried upright before the right shoulder: the right hand high on the pike,
    // the left at the waist below it on the same line.
    counts: [0, 0.3, 0.6, 0.9].map((t) => ({
      t,
      name: "carry the colours",
      place: { by: "upright", hand: "R", station: 0.75 } as const,
      holds: [{ hand: "L" as const, between: [0.1, 0.55] as [number, number] }],
      against: [
        { mark: "shoulder.R" as const, within: 0.2, says: "the staff before the right shoulder" },
      ],
    })),
  },
];

export const drillOf = (clip: string): Drill | undefined => DRILLS.find((d) => d.clip === clip);

/** The grip point of a hand: in front of the palm's skin, where the axis of what it holds runs. */
export function gripPoint(marks: Marks, hand: Side): Vec3 {
  const p = marks(`palm.${hand}`);
  return [
    p.position[0] + p.normal[0] * GRIP_DEPTH,
    p.position[1] + p.normal[1] * GRIP_DEPTH,
    p.position[2] + p.normal[2] * GRIP_DEPTH,
  ];
}

const sub = (a: Vec3, b: readonly number[]): Vec3 => [
  a[0] - (b[0] as number),
  a[1] - (b[1] as number),
  a[2] - (b[2] as number),
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The piece where a count places it. */
export function placePiece(drill: Drill, count: Count, marks: Marks): Piece {
  const length = drill.piece === "musket" ? MUSKET.length : COLOUR_STAFF.length;
  const p = count.place;
  const grip = gripPoint(marks, p.hand);
  if (p.by === "grounded")
    return { kind: drill.piece, heel: [grip[0], 0, grip[2]], axis: [0, 1, 0], length };
  if (p.by === "upright")
    return {
      kind: drill.piece,
      heel: [grip[0], grip[1] - p.station, grip[2]],
      axis: [0, 1, 0],
      length,
    };
  const other = gripPoint(marks, p.hand === "R" ? "L" : "R");
  const axis = unit(sub(other, grip));
  return {
    kind: drill.piece,
    heel: [
      grip[0] - axis[0] * p.station,
      grip[1] - axis[1] * p.station,
      grip[2] - axis[2] * p.station,
    ],
    axis,
    length,
  };
}

/** A point on the piece, `station` metres from its heel. */
export const stationPoint = (piece: Piece, station: number): Vec3 => [
  piece.heel[0] + piece.axis[0] * station,
  piece.heel[1] + piece.axis[1] * station,
  piece.heel[2] + piece.axis[2] * station,
];

/** Where a point is against the piece's axis line: how far along it, and how far from it. */
export function againstAxis(piece: Piece, point: Vec3): { station: number; off: number } {
  const d = sub(point, piece.heel);
  const station = dot(d, piece.axis);
  const off = Math.hypot(
    d[0] - piece.axis[0] * station,
    d[1] - piece.axis[1] * station,
    d[2] - piece.axis[2] * station,
  );
  return { station, off };
}

/** One requirement of a count, measured: what it is, the measure and its bound, metres. */
export interface Finding {
  what: string;
  measured: number;
  bound: number;
  ok: boolean;
}

/** Measures a count's requirements on a posed figure, the piece placed as the count places it. */
export function judgeCount(
  drill: Drill,
  count: Count,
  marks: Marks,
): { piece: Piece; findings: Finding[] } {
  const piece = placePiece(drill, count, marks);
  const findings: Finding[] = [];
  const add = (what: string, measured: number, bound: number) =>
    findings.push({ what, measured, bound, ok: measured <= bound });
  for (const h of count.holds) {
    const at = againstAxis(piece, gripPoint(marks, h.hand));
    add(`${count.name}: hand.${h.hand} on the ${drill.piece}`, at.off, GRIP_REACH);
    const [lo, hi] = h.between;
    // How far outside its stations the grip is, zero within them.
    add(
      `${count.name}: hand.${h.hand} between stations ${lo.toFixed(2)} and ${hi.toFixed(2)} m`,
      Math.max(0, lo - at.station, at.station - hi),
      0,
    );
  }
  for (const t of count.touches ?? []) {
    const p = stationPoint(piece, t.station);
    const m = marks(t.near).position;
    const o = t.offset ?? [0, 0, 0];
    const d = sub(p, [m[0] + o[0], m[1] + o[1], m[2] + o[2]]);
    const measured =
      t.axis === "y" ? Math.abs(d[1]) : t.axis === "xz" ? Math.hypot(d[0], d[2]) : Math.hypot(...d);
    add(`${count.name}: ${t.says}`, measured, t.within);
  }
  for (const a of count.against ?? []) {
    const m = marks(a.mark).position;
    add(`${count.name}: ${a.says}`, againstAxis(piece, [m[0], m[1], m[2]]).off, a.within);
  }
  for (const r of count.reaches ?? []) {
    const m = marks(r.mark).position;
    const to =
      r.to === "muzzle"
        ? stationPoint(piece, piece.length)
        : (marks(r.to).position as unknown as Vec3);
    add(`${count.name}: ${r.says}`, Math.hypot(...sub([m[0], m[1], m[2]], to)), r.within);
  }
  return { piece, findings };
}
