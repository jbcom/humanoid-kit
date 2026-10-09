/**
 * Named expressions made of MakeHuman's face units (docs/ARCHITECTURE.md,
 * "Expressions"). The body pack carries the 60 units (`JawDrop`,
 * `LeftUpperLidClosed`, ...) and `faceUnitRotations` blends any weights of
 * them; these are the weights that make the faces people ask for. The result
 * of `expressionUnits` is what `HumanoidPose.faceUnits` takes.
 *
 * The expressions follow the facial action coding system's prototypes for the
 * emotions (Ekman and Friesen, "Facial Action Coding System", 1978, and Ekman,
 * Friesen and Hager's 2002 manual; the prototypes as tabulated in the EMFACS
 * literature, taken here from memory of them and not re-read):
 *
 *   happiness  AU6 + AU12            cheek raiser, lip corner puller
 *   sadness    AU1 + AU4 + AU15 (+17) inner brow raiser, brow lowerer, lip corner depressor, chin raiser
 *   surprise   AU1 + AU2 + AU5 + AU26  brow raisers, upper lid raiser, jaw drop
 *   fear       AU1 + AU2 + AU4 + AU5 + AU20 + AU26  as surprise, with the lip stretcher
 *   anger      AU4 + AU5 + AU7 + AU23   brow lowerer, upper lid raiser, lid tightener, lip tightener
 *   disgust    AU9 or AU10 (+ AU15, AU17)  nose wrinkler, upper lip raiser
 *
 * onto MakeHuman's units: AU1 `InnerBrowUp`, AU2 `OuterBrowUp`, AU4 `BrowDown`,
 * AU5 `UpperLidOpen`, AU6 `CheekUp` (with `LowerLidUp`), AU7 `LowerLidUp`, AU9
 * `NoseWrinkler`, AU10 `UpperLipUp`, AU12 `MouthPullUp`, AU15 `MouthPullDown`,
 * AU17 `lowerLipUp`, AU20 `MouthPlatysma`, AU26 `JawDrop`. The pack has no lip
 * tightener (AU23), so anger presses nothing and relies on the brows, lids and
 * nose; fear leaves AU4 out, since the brow lowerer and the raisers' units cancel.
 *
 * CHOICE, not measurement. A face unit is MakeHuman's own bone-driven shape and
 * not a FACS unit, so which units and at what weight are authored here, set by
 * looking at the result across ages and tones (docs/evidence/expressions.md)
 * and are numbers to tune, not a standard.
 *
 * Every expression is symmetric: a left unit is always held at the weight of
 * its right, which `mirrorUnit` pairs and a test checks. A one-sided face (a
 * wink, a smirk) is a pose the caller composes from units.
 */

export interface FaceExpression {
  id: string;
  /** What a picker shows. */
  label: string;
  /** Face unit weights, 0 (exclusive) to 1: what `HumanoidPose.faceUnits` takes. */
  faceUnits: Readonly<Record<string, number>>;
}

/** A unit on both sides at `w`: `both("BrowDown", 1)` is the left and the right brow down. */
function both(name: string, w: number): Record<string, number> {
  return { [`Left${name}`]: w, [`Right${name}`]: w };
}

/** The mouth units, named `Mouth<Side><Pull>`, on both sides at `w`. */
function mouth(pull: string, w: number): Record<string, number> {
  return { [`MouthLeft${pull}`]: w, [`MouthRight${pull}`]: w };
}

/**
 * The expressions, in the order a picker offers them. Each is documented by
 * what it holds: the brows, the lids and cheeks, the nose, the mouth.
 */
export const EXPRESSIONS: readonly FaceExpression[] = [
  {
    id: "smile",
    label: "Smile",
    // Mouth corners up and back, cheeks raised and the lower lids with them (the
    // eyes crinkle in a real smile), the fold from nose to mouth deepened.
    faceUnits: {
      ...mouth("PullUp", 1),
      ...both("CheekUp", 0.6),
      ...both("LowerLidUp", 0.3),
      NasolabialDeepener: 0.4,
    },
  },
  {
    id: "grin",
    label: "Grin",
    // A smile with the teeth shown: the upper lip lifted and the jaw dropped a little.
    faceUnits: {
      ...mouth("PullUp", 1),
      ...both("CheekUp", 0.7),
      ...both("LowerLidUp", 0.4),
      NasolabialDeepener: 0.5,
      UpperLipUp: 0.6,
      lowerLipDown: 0.4,
      JawDrop: 0.3,
    },
  },
  {
    id: "frown",
    label: "Frown",
    // Brows drawn down, the corners of the mouth pulled down and back, the chin
    // lifted a little.
    faceUnits: {
      ...both("BrowDown", 1),
      ...mouth("PullDown", 1),
      ...mouth("Platysma", 0.5),
      lowerLipUp: 0.3,
    },
  },
  {
    id: "surprise",
    label: "Surprise",
    // Both parts of the brow raised (0.7: at full weight the lift is a boxy ridge over
    // each eye, which the forehead's lines carry the rest of), the upper lids lifted
    // wide, the jaw dropped.
    faceUnits: {
      ...both("InnerBrowUp", 0.7),
      ...both("OuterBrowUp", 0.7),
      ...both("UpperLidOpen", 1),
      JawDrop: 0.5,
    },
  },
  {
    id: "anger",
    label: "Anger",
    // Brows down and together, the lower lids tightened, the nose wrinkled, the
    // upper lip raised off the teeth, the corners drawn down.
    faceUnits: {
      ...both("BrowDown", 1),
      ...both("UpperLidOpen", 0.3),
      ...both("LowerLidUp", 0.35),
      NoseWrinkler: 0.4,
      NasolabialDeepener: 0.6,
      UpperLipUp: 0.5,
      ...mouth("PullDown", 0.6),
    },
  },
  {
    id: "disgust",
    label: "Disgust",
    // The nose wrinkled, the upper lip lifted high, cheeks raised, brows a
    // little down.
    faceUnits: {
      NoseWrinkler: 1,
      UpperLipUp: 0.9,
      ...both("CheekUp", 0.6),
      ...both("BrowDown", 0.5),
      ...both("LowerLidUp", 0.5),
      lowerLipDown: 0.3,
    },
  },
  {
    id: "fear",
    label: "Fear",
    // Inner brows raised, upper lids wide, the corners of the mouth stretched
    // back and down (the platysma), the jaw slightly dropped.
    faceUnits: {
      ...both("InnerBrowUp", 0.8),
      ...both("OuterBrowUp", 0.2),
      ...both("UpperLidOpen", 1),
      ...mouth("Platysma", 1),
      JawDrop: 0.35,
    },
  },
  {
    id: "sad",
    label: "Sadness",
    // Inner brows raised and drawn together, the upper lids drooping, the
    // corners of the mouth down, the chin pushed up under the lower lip.
    faceUnits: {
      ...both("InnerBrowUp", 0.9),
      ...both("BrowDown", 0.35),
      ...both("UpperLidClosed", 0.25),
      ...mouth("PullDown", 1),
      ...mouth("Platysma", 0.5),
      lowerLipUp: 0.6,
    },
  },
  {
    id: "blink",
    label: "Blink",
    faceUnits: { ...both("UpperLidClosed", 1), ...both("LowerLidUp", 0.4) },
  },
  {
    id: "squint",
    label: "Squint",
    // Lids narrowed from below, cheeks raised, brows a little down: against the
    // sun, or a hard laugh.
    faceUnits: {
      ...both("LowerLidUp", 1),
      ...both("CheekUp", 0.7),
      ...both("BrowDown", 0.4),
      ...both("UpperLidClosed", 0.4),
    },
  },
];

/**
 * The face units of expression `id` at `intensity` (0 to 1; stronger is held
 * at 1): every weight scaled, none left in at 0.
 */
export function expressionUnits(id: string, intensity = 1): Record<string, number> {
  const expression = EXPRESSIONS.find((e) => e.id === id);
  if (!expression) throw new Error(`unknown expression ${id}`);
  const k = Math.min(1, Math.max(0, intensity));
  if (k === 0) return {};
  return Object.fromEntries(Object.entries(expression.faceUnits).map(([u, w]) => [u, w * k]));
}
