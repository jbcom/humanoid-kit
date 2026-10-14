/** React ownership for a frame-driven cached self-contact constraint. */
import { useEffect, useRef } from "react";
import {
  createSiteContactConstraint,
  type SiteContactConstraint,
} from "../interaction/siteContactConstraint.ts";

/**
 * Owns one cached site-contact constraint for a mounted figure. Call `update`
 * from the same frame writer that owns the figure's source pose; it performs no
 * React state updates and never solves during render. Unmount releases buffers.
 */
export function useSiteContactConstraint(): SiteContactConstraint {
  const constraint = useRef<SiteContactConstraint | null>(null);
  if (!constraint.current) constraint.current = createSiteContactConstraint();
  const current = constraint.current;
  useEffect(() => () => current.dispose(), [current]);
  return current;
}
