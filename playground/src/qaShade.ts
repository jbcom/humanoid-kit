/**
 * Mounts the shot's QA draw (`qaDraw`: `?nofold=`, `?shade=`) and exposes
 * `window.hkShotNotes` (`foldNotes`), which the contact-sheet runner writes
 * beside each sheet.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { applyQaDraw, type BodyFoldNote, foldNotes, qaDraw } from "./qaDraw";

const draw = qaDraw(new URLSearchParams(window.location.search));
const active = draw.off.size > 0 || draw.shade !== "lit";

export function QaShade() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    window.hkShotNotes = () => foldNotes(scene);
    return () => {
      delete window.hkShotNotes;
    };
  }, [scene]);
  useFrame(() => {
    if (active) applyQaDraw(scene, draw);
  });
  return null;
}

declare global {
  interface Window {
    /** QA only: the body meshes' folds as drawn (see `foldNotes`). */
    hkShotNotes?: () => BodyFoldNote[];
  }
}
