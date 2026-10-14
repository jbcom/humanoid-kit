/** Accounts for environment-dependent skips in the Vitest projects. */
export interface VitestSkippedTest {
  moduleId: string;
  fullName: string;
}

/** The renderer profile that decided whether a GPU assertion must execute. */
export type VitestSkipProfile = "software" | "canonical-hardware" | "unclassified";

/**
 * A software reference run may lack alpha-to-coverage. The admitted Metal lane
 * is the canonical hardware proof, so a feature skip there is a failure. An
 * automatic local choice is deliberately unclassified rather than assumed to
 * be either one.
 */
export function vitestSkipProfile(gpuMode: string): VitestSkipProfile {
  if (gpuMode === "software") return "software";
  if (gpuMode === "macos-hardware-metal") return "canonical-hardware";
  return "unclassified";
}

interface ExpectedSkip {
  moduleSuffix: string;
  fullName?: string;
  reason: string;
  /** Undefined means the opt-in skip is valid on every execution profile. */
  profiles?: readonly VitestSkipProfile[];
}

const EXPECTED_SKIPS: readonly ExpectedSkip[] = [
  {
    moduleSuffix: "/tests/browser/affordanceGpu.test.tsx",
    fullName:
      "the affordance handle against the GPU > captures default and custom body materials in the seated jaw-open pose",
    reason: "the opt-in custom-material capture is disabled",
  },
  {
    moduleSuffix: "/tests/browser/facialHairLengthInspection.test.tsx",
    reason: "the dedicated facial-hair inspection is disabled",
  },
  {
    moduleSuffix: "/tests/browser/facialHairGrowthInspection.test.tsx",
    reason: "the dedicated source-card growth inspection is disabled",
  },
  {
    moduleSuffix: "/tests/browser/miniatureFacialHairInspection.test.tsx",
    reason: "the dedicated miniature source-card inspection is disabled",
  },
  {
    moduleSuffix: "/tests/browser/injuryInspection.test.tsx",
    reason: "the dedicated injury inspection is disabled",
  },
  {
    moduleSuffix: "/tests/browser/hair.test.ts",
    fullName: "hair cut-outs > smooths the edge with alpha-to-coverage on a multisampled target",
    reason: "the software reference WebGL context lacks alpha-to-coverage",
    profiles: ["software"],
  },
  {
    moduleSuffix: "/tests/browser/hair.test.ts",
    fullName:
      "hairlines and fins > ramps a hairline's strand edges over more than a pixel under MSAA: no step from empty to whole between neighbours",
    reason: "the software reference WebGL context lacks alpha-to-coverage",
    profiles: ["software"],
  },
];

export interface VitestSkipLedger {
  profile: VitestSkipProfile;
  byReason: Record<string, number>;
  skipped: Array<VitestSkippedTest & { reason: string }>;
  failures: string[];
}

function expectedSkip(test: VitestSkippedTest): ExpectedSkip | undefined {
  return EXPECTED_SKIPS.find(
    (entry) =>
      test.moduleId.endsWith(entry.moduleSuffix) &&
      (!entry.fullName || test.fullName === entry.fullName),
  );
}

export function vitestSkipLedger(
  tests: readonly VitestSkippedTest[],
  profile: VitestSkipProfile,
): VitestSkipLedger {
  const byReason: Record<string, number> = {};
  const skipped: VitestSkipLedger["skipped"] = [];
  const failures: string[] = [];
  for (const test of tests) {
    const entry = expectedSkip(test);
    if (!entry) {
      failures.push(`unaccounted Vitest skip in ${test.moduleId}: "${test.fullName}"`);
      continue;
    }
    if (entry.profiles && !entry.profiles.includes(profile)) {
      failures.push(
        `Vitest skip in ${test.moduleId}: "${test.fullName}" is not allowed on the ${profile} profile (${entry.reason})`,
      );
      continue;
    }
    skipped.push({ ...test, reason: entry.reason });
    byReason[entry.reason] = (byReason[entry.reason] ?? 0) + 1;
  }
  return { profile, byReason, skipped, failures };
}
