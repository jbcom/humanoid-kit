/** Accounts for environment-dependent skips in the Vitest projects. */
export interface VitestSkippedTest {
  moduleId: string;
  fullName: string;
}

interface ExpectedSkip {
  moduleSuffix: string;
  fullName?: string;
  reason: string;
}

const EXPECTED_SKIPS: readonly ExpectedSkip[] = [
  {
    moduleSuffix: "/tests/animation.test.ts",
    fullName: "the retarget > takes a source in its T-pose to the target in its own",
    reason: "the optional Quaternius fixture is absent",
  },
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
    moduleSuffix: "/tests/browser/injuryInspection.test.tsx",
    reason: "the dedicated injury inspection is disabled",
  },
  {
    moduleSuffix: "/tests/browser/hair.test.ts",
    fullName: "hair cut-outs > smooths the edge with alpha-to-coverage on a multisampled target",
    reason: "the WebGL context lacks alpha-to-coverage",
  },
  {
    moduleSuffix: "/tests/browser/hair.test.ts",
    fullName:
      "hairlines and fins > ramps a hairline's strand edges over more than a pixel under MSAA: no step from empty to whole between neighbours",
    reason: "the WebGL context lacks alpha-to-coverage",
  },
];

export interface VitestSkipLedger {
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

export function vitestSkipLedger(tests: readonly VitestSkippedTest[]): VitestSkipLedger {
  const byReason: Record<string, number> = {};
  const skipped: VitestSkipLedger["skipped"] = [];
  const failures: string[] = [];
  for (const test of tests) {
    const entry = expectedSkip(test);
    if (!entry) {
      failures.push(`unaccounted Vitest skip in ${test.moduleId}: "${test.fullName}"`);
      continue;
    }
    skipped.push({ ...test, reason: entry.reason });
    byReason[entry.reason] = (byReason[entry.reason] ?? 0) + 1;
  }
  return { byReason, skipped, failures };
}
