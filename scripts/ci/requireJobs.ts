/**
 * The verdict of `CI / gate`: every required job must have run and succeeded.
 *
 * A job that is skipped, cancelled, failed or absent from `needs` fails the gate.
 * One job has a legitimate skip: SonarCloud cannot read its token on a pull request
 * from a fork or from Dependabot, so its own `if:` is false there and the workflow
 * tells the gate (`SONAR_RUNS=false`) that "skipped" is the expected result. Where
 * SonarCloud is expected to run, "skipped" fails like any other job.
 */

export const REQUIRED_JOBS = [
  "verify-unit",
  "verify-browser",
  "verify-affordance-gpu-metal",
  "verify-bake",
  "coverage-merge",
  "docs",
  "e2e",
  "lighthouse",
  "sonarcloud",
  "pre-commit",
] as const;

export type JobName = (typeof REQUIRED_JOBS)[number];

/** The shape of `toJSON(needs)` in a workflow. */
export type Needs = Readonly<Record<string, { result?: string } | undefined>>;

export interface Verdict {
  ok: boolean;
  /** One line per required job: its name, its result and whether it is acceptable. */
  lines: string[];
  /** The jobs that did not meet the bar, with why. */
  failures: string[];
}

export function gateVerdict(needs: Needs, options: { sonarRuns: boolean }): Verdict {
  const lines: string[] = [];
  const failures: string[] = [];
  for (const job of REQUIRED_JOBS) {
    const result = needs[job]?.result ?? "absent";
    const mayBeSkipped = job === "sonarcloud" && !options.sonarRuns;
    const ok = result === "success" || (mayBeSkipped && result === "skipped");
    lines.push(`${ok ? "ok  " : "FAIL"} ${job}: ${result}`);
    if (!ok)
      failures.push(
        result === "skipped"
          ? `${job} was skipped, and a required job must run`
          : `${job} finished ${result}`,
      );
  }
  return { ok: failures.length === 0, lines, failures };
}

if (import.meta.main) {
  const raw = process.env.NEEDS_JSON;
  if (!raw) throw new Error("NEEDS_JSON (toJSON(needs)) is required");
  const sonarRuns = process.env.SONAR_RUNS;
  if (sonarRuns !== "true" && sonarRuns !== "false")
    throw new Error(`SONAR_RUNS must be "true" or "false", received ${sonarRuns ?? "nothing"}`);
  const verdict = gateVerdict(JSON.parse(raw) as Needs, { sonarRuns: sonarRuns === "true" });
  console.log(verdict.lines.join("\n"));
  if (!verdict.ok) {
    console.error(verdict.failures.map((failure) => `::error::${failure}`).join("\n"));
    process.exit(1);
  }
}
