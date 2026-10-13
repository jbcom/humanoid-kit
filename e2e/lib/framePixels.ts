/**
 * Reading a rendered frame's pixels in an end-to-end test.
 *
 * The playground's canvases do not retain their WebGL drawing buffer (the
 * creator, the QA shot and the walk scene all leave `preserveDrawingBuffer`
 * off). Once a frame is presented the buffer is cleared, so `drawImage` of the
 * canvas, `toDataURL` or `readPixels` from a test's script return an empty,
 * transparent frame: a corner reads black, and every pixel differs from the
 * background key. What people see is what the compositor shows, so a test reads
 * that: a screenshot of the canvas, decoded to RGBA in Node.
 */
import type { Locator } from "@playwright/test";
import sharp from "sharp";

/** A frame as the compositor showed it: `width × height` RGBA, rows top to bottom. */
export interface Frame {
  width: number;
  height: number;
  data: Uint8Array;
  /** The screenshot itself, to attach to a test as its evidence. */
  png: Buffer;
}

/**
 * The canvas's current frame, at device pixels (the size of its backing store
 * when the renderer follows the device pixel ratio, as react-three-fiber does).
 * Wait for the frame to be drawn first: a ready marker means evaluated, not drawn.
 */
export async function framePixels(canvas: Locator): Promise<Frame> {
  const png = await canvas.screenshot({ scale: "device" });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`decoded ${info.channels} channels, expected RGBA`);
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    png,
  };
}
