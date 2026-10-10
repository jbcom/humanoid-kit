/**
 * The `useFrame` priority a figure's per-frame work runs at (its pose, clip,
 * fold fade, jaw and channel clip): negative, so it runs before a caller's own
 * `useFrame` (priority 0), which then reads the pose of the frame about to be
 * drawn, and React Three Fiber keeps rendering on its own (only a positive
 * priority takes the render over).
 */
export const FIGURE_FRAME_PRIORITY = -1;
