/**
 * Finds the places a browser test compares a large numeric buffer with a raw
 * `toEqual` / `toStrictEqual`, which hangs the run when it fails (see
 * tests/browser/arrays.ts). Text-based, since the compiler's API is not available to
 * the unit project, so it is a tripwire on the shapes that have gone wrong rather than
 * a type check:
 *
 * - an operand that is, or is bound (`const x = ...`, transitively, in the same file)
 *   to, a typed array (`new Float32Array(...)`, `Array.from(...)`) or to a render
 *   helper's result (anything imported from `./layerRender`);
 * - an array literal of more than {@link MAX_LITERAL} elements.
 *
 * What it cannot see is a large array that reaches `toEqual` out of a function declared
 * in another file. A fix for that is to route it through `expectSameArray`, not to
 * widen this scan.
 */

/** The most elements an array literal may have in a raw `toEqual`. */
export const MAX_LITERAL = 16;

export interface RawComparison {
  line: number;
  matcher: string;
  why: string;
}

const TYPED_ARRAYS =
  "(?:Float32|Float64|Uint8|Uint8Clamped|Uint16|Uint32|Int8|Int16|Int32|BigInt64|BigUint64)Array";
const SOURCE = new RegExp(`new\\s+${TYPED_ARRAYS}\\b|\\bArray\\.from\\s*\\(`);

/** The text with comments and string contents blanked, so positions are unchanged. */
function mask(text: string): string {
  const out = text.split("");
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
    } else i++;
  }
  return out.join("");
}

/** The index of the bracket closing the one at `open`, or -1. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The index of the bracket opening the one that closes at `close`, or -1. */
function opening(text: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    const c = text[i];
    if (c === ")" || c === "]" || c === "}") depth++;
    else if (c === "(" || c === "[" || c === "{") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Top-level elements of the array literal `[...]`. */
function literalLength(literal: string): number {
  const body = literal.slice(1, -1);
  if (body.trim() === "") return 0;
  let depth = 0;
  let count = 1;
  for (const c of body) {
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) count++;
  }
  // A trailing comma adds no element.
  return body.trimEnd().endsWith(",") ? count - 1 : count;
}

/** True when `name` appears in `expr` as an identifier (not as a property). */
const mentions = (expr: string, name: string) =>
  new RegExp(`(?<![.\\w$])${name.replaceAll("$", "\\$")}\\b`).test(expr);

/**
 * The names that stand for a typed array or a render result in this file: what it
 * imports from the layer renderer under a `render` name, and each `const x = ...` whose
 * value is a typed array, an `Array.from`, or one of those names (a function's body does
 * not count: `const at = (page) => Array.from(page)` is a function, not an array).
 */
function taintedNames(masked: string, original: string): Set<string> {
  const names = new Set<string>();
  for (const m of original.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*["']\.\/layerRender(?:\.ts)?["']/g,
  ))
    for (const part of (m[1] as string).split(",")) {
      const [name, alias] = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/);
      const local = (alias ?? name)?.trim();
      if (name?.startsWith("render") && local) names.add(local);
    }
  const valueIsBuffer = (expr: string) => {
    const value = expr.trim();
    return (
      new RegExp(
        `^(?:new\\s+${TYPED_ARRAYS}\\b|${TYPED_ARRAYS}\\.(?:from|of)\\s*\\(|Array\\.from\\s*\\()`,
      ).test(value) ||
      [...names].some((n) => new RegExp(`^${n.replaceAll("$", "\\$")}\\b`).test(value))
    );
  };
  for (let grew = true; grew; ) {
    grew = false;
    for (const m of masked.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*);/g)) {
      const name = m[1] as string;
      if (!names.has(name) && valueIsBuffer(m[2] as string)) {
        names.add(name);
        grew = true;
      }
    }
  }
  return names;
}

/** Every raw `toEqual` / `toStrictEqual` in `source` that compares a large buffer. */
export function findRawArrayComparisons(source: string): RawComparison[] {
  const masked = mask(source);
  const tainted = taintedNames(masked, source);
  const touches = (operand: string): string | null => {
    if (SOURCE.test(operand)) return "a typed array or Array.from(...)";
    for (const name of tainted)
      if (mentions(operand, name)) return `\`${name}\`, a typed array or render result`;
    return null;
  };
  const found: RawComparison[] = [];
  for (const m of masked.matchAll(/\.(toEqual|toStrictEqual)\s*\(/g)) {
    const matcher = m[1] as string;
    const argOpen = (m.index as number) + m[0].length - 1;
    const argClose = closing(masked, argOpen);
    const line = source.slice(0, m.index).split("\n").length;
    const argument = argClose < 0 ? "" : masked.slice(argOpen + 1, argClose).trim();
    // Back over `.not`, `.resolves` and the like to the `)` closing `expect(...)`.
    let cursor = (m.index as number) - 1;
    for (;;) {
      while (/\s/.test(masked[cursor] ?? "")) cursor--;
      const chain = /\.(?:not|resolves|rejects)$/.exec(
        masked.slice(Math.max(0, cursor - 9), cursor + 1),
      );
      if (!chain) break;
      cursor -= chain[0].length;
    }
    const subjectOpen = masked[cursor] === ")" ? opening(masked, cursor) : -1;
    const subject = subjectOpen < 0 ? "" : masked.slice(subjectOpen + 1, cursor);
    for (const operand of [subject, argument]) {
      const trimmed = operand.trim();
      if (trimmed.startsWith("[") && closing(trimmed, 0) === trimmed.length - 1) {
        const length = literalLength(trimmed);
        if (length > MAX_LITERAL) {
          found.push({ line, matcher, why: `an array literal of ${length} elements` });
          break;
        }
      }
      const why = touches(operand);
      if (why) {
        found.push({ line, matcher, why });
        break;
      }
    }
  }
  return found;
}
