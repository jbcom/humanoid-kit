/**
 * Parser for MakeHuman's MHCLO format: the binding that makes a child mesh
 * (eyes, teeth, hair, clothes, proxy bodies) follow every shape change of the
 * base mesh.
 *
 * Each child vertex is either an exact base vertex, or a weighted combination
 * of three base vertices plus an offset; offsets are scaled per axis by the
 * ratio of a reference distance on the current body to the same distance
 * recorded in the file (`x_scale v1 v2 dist`). Faces under the garment are
 * listed in `delete_verts`.
 *
 * Section rules follow the format's documented behaviour (a blank line or a
 * non-numeric line ends a section; `material` and comments may appear inside
 * the vertex block). Three behaviours of one existing reader are deliberately
 * not reproduced: licence comments are recorded verbatim rather than
 * classified by substring; multi-word names, tags and authors are kept whole;
 * and the line that ends a section is still read as a keyword, so a
 * `delete_verts` written without a blank line before it is not lost.
 */

export interface AxisScale {
  /** Base vertex indices whose distance along the axis is measured. */
  v1: number;
  v2: number;
  /** The distance between them when the asset was fitted (MakeHuman units). */
  reference: number;
}

export interface MhcloBinding {
  name: string;
  uuid: string | null;
  author: string | null;
  /** The licence statement exactly as written in the file, if any. */
  licenseLine: string | null;
  objFile: string;
  material: string | null;
  zDepth: number;
  tags: string[];
  scale: { x: AxisScale; y: AxisScale; z: AxisScale } | null;
  /** Per child vertex: three base vertex indices (exact matches repeat the index with weights 1,0,0). */
  refVerts: Uint32Array;
  weights: Float32Array;
  /** Per child vertex offset in MakeHuman units, before axis scaling. */
  offsets: Float32Array;
  /** Base vertices hidden while this asset is worn. */
  deleteVerts: Uint32Array;
}

export class MhcloError extends Error {
  override name = "MhcloError";
}

const isNumeric = (w: string | undefined) => w !== undefined && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(w);

export function parseMhclo(text: string): MhcloBinding {
  let name = "";
  let uuid: string | null = null;
  let author: string | null = null;
  let licenseLine: string | null = null;
  let objFile: string | null = null;
  let material: string | null = null;
  let zDepth = 50;
  const tags: string[] = [];
  const scale: Partial<Record<"x" | "y" | "z", AxisScale>> = {};
  const ref: number[] = [];
  const w: number[] = [];
  const off: number[] = [];
  const del: number[] = [];
  let section: "none" | "verts" | "delete" = "none";

  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = (lines[n] as string).trim();
    const words = line.split(/\s+/);
    const key = words[0] ?? "";
    if (line.startsWith("#")) {
      const tag = (words[1] ?? "").toLowerCase().replace(/:$/, "");
      if (words.length > 2 && tag === "author") author = words.slice(2).join(" ");
      if (words.length > 2 && tag === "license") licenseLine = line;
      continue;
    }
    if (key === "material") {
      material = words.slice(1).join(" ");
      continue;
    }
    if (section !== "none") {
      if (line === "") {
        section = "none";
        continue;
      }
      if (!isNumeric(key)) {
        // A non-numeric line ends the section. One reader discards it, which loses
        // a `delete_verts` written straight after the vertex block; reading it as a
        // keyword below cannot break a valid file and keeps the author's intent.
        section = "none";
      }
    }
    if (section !== "none") {
      if (section === "verts") {
        const nums = words.map(Number);
        if (nums.length === 1) {
          ref.push(nums[0] as number, nums[0] as number, nums[0] as number);
          w.push(1, 0, 0);
          off.push(0, 0, 0);
        } else if (nums.length >= 9) {
          ref.push(nums[0] as number, nums[1] as number, nums[2] as number);
          w.push(nums[3] as number, nums[4] as number, nums[5] as number);
          off.push(nums[6] as number, nums[7] as number, nums[8] as number);
        } else {
          throw new MhcloError(
            `line ${n + 1}: a vertex line needs 1 or 9 fields, got ${nums.length}`,
          );
        }
      } else {
        for (let i = 0; i < words.length; i++) {
          if (words[i + 1] === "-" && isNumeric(words[i + 2])) {
            for (let v = Number(words[i]); v <= Number(words[i + 2]); v++) del.push(v);
            i += 2;
          } else if (isNumeric(words[i])) del.push(Number(words[i]));
        }
      }
      continue;
    }
    switch (key) {
      case "name":
        name = words.slice(1).join(" ");
        break;
      case "uuid":
        uuid = words[1] ?? null;
        break;
      case "author":
        author = words.slice(1).join(" ");
        break;
      case "license":
        licenseLine = line;
        break;
      case "obj_file":
        objFile = words.slice(1).join(" ");
        break;
      case "z_depth":
        zDepth = Number(words[1]);
        break;
      case "tag":
        tags.push(words.slice(1).join(" "));
        break;
      case "x_scale":
      case "y_scale":
      case "z_scale":
        scale[key[0] as "x" | "y" | "z"] = {
          v1: Number(words[1]),
          v2: Number(words[2]),
          reference: Number(words[3]),
        };
        break;
      case "verts":
        if (words[1] !== undefined) section = "verts";
        break;
      case "delete_verts":
        section = "delete";
        break;
      default:
        break;
    }
  }
  if (!objFile) throw new MhcloError("missing obj_file");
  const hasScale = scale.x && scale.y && scale.z;
  return {
    name,
    uuid,
    author,
    licenseLine,
    objFile,
    material,
    zDepth,
    tags,
    scale: hasScale
      ? { x: scale.x as AxisScale, y: scale.y as AxisScale, z: scale.z as AxisScale }
      : null,
    refVerts: Uint32Array.from(ref),
    weights: Float32Array.from(w),
    offsets: Float32Array.from(off),
    deleteVerts: Uint32Array.from(new Set(del)),
  };
}
