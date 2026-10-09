/**
 * The small quaternion algebra the rig shares: rotations as (x, y, z, w)
 * tuples, the product, and rotating a vector.
 */
export type Quat = [number, number, number, number];

/** The product `a · b`: applies `b` first, then `a`. */
export const mul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/** Rotates `v` by unit quaternion `q`. */
export const rotate = (q: Quat, x: number, y: number, z: number): [number, number, number] => {
  // v' = v + 2w(q×v) + 2 q×(q×v)
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
};

/** The inverse of unit quaternion `q`. */
export const conjugate = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** The shortest rotation taking direction `a` to direction `b` (neither need be unit; neither may be zero). */
export function between(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): Quat {
  const la = Math.hypot(a[0], a[1], a[2]);
  const lb = Math.hypot(b[0], b[1], b[2]);
  const ux = a[0] / la;
  const uy = a[1] / la;
  const uz = a[2] / la;
  const vx = b[0] / lb;
  const vy = b[1] / lb;
  const vz = b[2] / lb;
  const dot = ux * vx + uy * vy + uz * vz;
  if (dot < -0.999999) {
    // Opposite: a half turn about any axis perpendicular to a.
    const [px, py, pz] = Math.abs(ux) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let ax = uy * (pz as number) - uz * (py as number);
    let ay = uz * (px as number) - ux * (pz as number);
    let az = ux * (py as number) - uy * (px as number);
    const n = Math.hypot(ax, ay, az);
    ax /= n;
    ay /= n;
    az /= n;
    return [ax, ay, az, 0];
  }
  // q = (a × b, 1 + a·b), normalised.
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const w = 1 + dot;
  const n = Math.hypot(x, y, z, w);
  return [x / n, y / n, z / n, w / n];
}
