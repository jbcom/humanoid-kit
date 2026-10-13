/**
 * `CI / gate` passes only when every required job ran and succeeded.
 *
 * The verdict lives in scripts/ci/requireJobs.ts so that a skipped job, which a
 * bare `needs.<job>.result == success` test cannot tell from a job that was never
 * wired in, is a failure the unit suite can prove.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gateVerdict, REQUIRED_JOBS } from "../scripts/ci/requireJobs.ts";

const allSucceeded = () =>
  Object.fromEntries(REQUIRED_JOBS.map((job) => [job, { result: "success" }]));

describe("CI gate verdict", () => {
  it("passes when every required job succeeded", () => {
    const verdict = gateVerdict(allSucceeded(), { sonarRuns: true });
    expect(verdict.ok).toBe(true);
    expect(verdict.failures).toEqual([]);
  });

  it.each(REQUIRED_JOBS.filter((job) => job !== "sonarcloud"))(
    "fails when %s is skipped, failed, cancelled or absent",
    (job) => {
      for (const result of ["skipped", "failure", "cancelled"]) {
        const verdict = gateVerdict({ ...allSucceeded(), [job]: { result } }, { sonarRuns: true });
        expect(verdict.ok, `${job} ${result}`).toBe(false);
        expect(verdict.failures.join("\n")).toContain(job);
      }
      const { [job]: _removed, ...without } = allSucceeded();
      expect(gateVerdict(without, { sonarRuns: true }).ok, `${job} absent`).toBe(false);
    },
  );

  it("fails when SonarCloud is skipped where it is expected to run", () => {
    const needs = { ...allSucceeded(), sonarcloud: { result: "skipped" } };
    const verdict = gateVerdict(needs, { sonarRuns: true });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toEqual(["sonarcloud was skipped, and a required job must run"]);
  });

  it("accepts a skipped SonarCloud only where it cannot run, and never a failed one", () => {
    const skipped = { ...allSucceeded(), sonarcloud: { result: "skipped" } };
    expect(gateVerdict(skipped, { sonarRuns: false }).ok).toBe(true);
    const failed = { ...allSucceeded(), sonarcloud: { result: "failure" } };
    expect(gateVerdict(failed, { sonarRuns: false }).ok).toBe(false);
  });

  it("names every needed job in the workflow's gate, and nothing else", () => {
    const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    const gate = workflow.slice(workflow.indexOf("\n  gate:\n"));
    const listed = /needs:\s*\[([^\]]+)\]/
      .exec(gate)?.[1]
      ?.split(",")
      .map((job) => job.trim());
    expect([...(listed ?? [])].sort()).toEqual([...REQUIRED_JOBS].sort());
  });

  it("exits non-zero from the command the workflow runs when a job is skipped", () => {
    const run = (needs: object, sonarRuns: string) =>
      spawnSync(process.execPath, ["scripts/ci/requireJobs.ts"], {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: { ...process.env, NEEDS_JSON: JSON.stringify(needs), SONAR_RUNS: sonarRuns },
      });
    expect(run(allSucceeded(), "true").status).toBe(0);
    const skipped = run({ ...allSucceeded(), e2e: { result: "skipped" } }, "true");
    expect(skipped.status).toBe(1);
    expect(skipped.stderr).toContain("::error::e2e was skipped");
  });
});
