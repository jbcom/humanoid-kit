/**
 * Demo tattoo images for the playground and its contact sheets, drawn here on
 * canvases (no image files, no fonts), so a recipe's `bodyArt.tattoos[].image`
 * can name them and every render draws the same pixels:
 *
 * - `compass`: black line work, a compass rose (the common case: carbon ink);
 * - `flash`: a flat-colour flash piece, red, yellow and green inks over a black
 *   outline, to show colour ink through every skin tone.
 */
import type { BodyArtImages } from "humanoid-kit/react";

/** The drawings' own units: every radius and line width below is in these. */
const DESIGN = 256;
/**
 * Pixels a side. The skin samples a tattoo's image no finer than the ink's
 * spread in the dermis (`INK_SPREAD`, 0.2 mm), and the sheets wear these at up
 * to 10 cm: 512 px puts 0.2 mm in a pixel, so the image is never what blurs.
 * The paths are vectors, so drawing them larger is exact.
 */
const SIZE = 512;

function canvas(draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.translate(SIZE / 2, SIZE / 2);
  g.scale(SIZE / DESIGN, SIZE / DESIGN);
  g.lineJoin = "round";
  g.lineCap = "round";
  draw(g);
  return c;
}

const INK = "#141416";

/** A star of `points` points between radii `outer` and `inner`, from straight up. */
function star(g: CanvasRenderingContext2D, points: number, outer: number, inner: number) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i * Math.PI) / points - Math.PI / 2;
    g.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  g.closePath();
}

const compass = () =>
  canvas((g) => {
    g.strokeStyle = INK;
    g.fillStyle = INK;
    // Bold traditional line work, 2 to 4 mm on a tattoo 8 to 10 cm across: the
    // body-art texture's texels are about 1.5 mm, so finer lines would blur grey.
    g.lineWidth = 12;
    g.beginPath();
    g.arc(0, 0, 108, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 6;
    g.beginPath();
    g.arc(0, 0, 88, 0, Math.PI * 2);
    g.stroke();
    star(g, 4, 116, 22);
    g.lineWidth = 9;
    g.stroke();
    // The north point solid, the rest in outline.
    g.beginPath();
    g.moveTo(0, -118);
    g.lineTo(-22, -22);
    g.lineTo(22, -22);
    g.closePath();
    g.fill();
    g.rotate(Math.PI / 4);
    star(g, 4, 70, 14);
    g.lineWidth = 7;
    g.stroke();
  });

const flash = () =>
  canvas((g) => {
    g.lineWidth = 7;
    g.strokeStyle = INK;
    // A heart in red, with a yellow banner and green leaves.
    g.beginPath();
    g.moveTo(0, 70);
    g.bezierCurveTo(-120, -10, -70, -110, 0, -50);
    g.bezierCurveTo(70, -110, 120, -10, 0, 70);
    g.closePath();
    g.fillStyle = "#c8202a";
    g.fill();
    g.stroke();
    for (const side of [-1, 1]) {
      g.beginPath();
      g.ellipse(side * 78, 64, 34, 14, side * 0.5, 0, Math.PI * 2);
      g.fillStyle = "#2f8a3a";
      g.fill();
      g.stroke();
    }
    g.beginPath();
    g.rect(-96, -14, 192, 34);
    g.fillStyle = "#f2c230";
    g.fill();
    g.stroke();
  });

let made: BodyArtImages | null = null;

/** The playground's tattoo images by key (made once). */
export function tattooImages(): BodyArtImages {
  made ??= { compass: compass(), flash: flash() };
  return made;
}
