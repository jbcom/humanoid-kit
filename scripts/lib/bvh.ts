/**
 * A BVH file's hierarchy of channels and its frames. Only what a pose or a clip
 * needs: the joints in file order with their channel names, the frames' values
 * (degrees, and offsets in the file's units, in channel order) and the frame
 * time; the joints' offsets are not read, since MakeHuman's rig fixes them.
 */
export interface ParsedBvh {
  joints: { name: string; channels: string[] }[];
  /** One row of channel values per frame, joints in file order. */
  frames: number[][];
  /** Seconds per frame. */
  frameTime: number;
}

/** Parses a BVH into per-frame, per-joint local Euler rotations (degrees, in the order the channels are written). */
export function parseBvh(text: string): ParsedBvh {
  const tokens = text.split(/\s+/).filter(Boolean);
  const joints: { name: string; channels: string[] }[] = [];
  let i = 0;
  while (tokens[i] !== "MOTION") {
    if (i >= tokens.length) throw new Error("BVH has no MOTION section");
    const t = tokens[i++];
    if (t === "ROOT" || t === "JOINT") joints.push({ name: tokens[i++] ?? "", channels: [] });
    else if (t === "End") i += 1;
    else if (t === "CHANNELS") {
      const n = Number(tokens[i++]);
      const j = joints[joints.length - 1];
      if (!j) throw new Error("CHANNELS before joint");
      j.channels = tokens.slice(i, i + n);
      i += n;
    }
  }
  i++; // MOTION
  i++; // Frames:
  const frames = Number(tokens[i++]);
  i += 2; // Frame Time:
  const frameTime = Number(tokens[i++]);
  const data: number[][] = [];
  for (let f = 0; f < frames; f++) {
    const row: number[] = [];
    for (const j of joints)
      for (let c = 0; c < j.channels.length; c++) row.push(Number(tokens[i++]));
    data.push(row);
  }
  return { joints, frames: data, frameTime };
}
