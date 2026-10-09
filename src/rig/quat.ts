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
