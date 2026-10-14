/** Acceptance policy is reviewed in source; recording measurements cannot promote a family. */
import { REST_POSE } from "./permutations.ts";
import { rowPasses, type SuiteRow } from "./suite.ts";

export const APPROVED_SMOKE_POSE_FAMILIES: readonly string[] = Object.freeze([REST_POSE]);

export const smokeRowKey = (row: SuiteRow): string => `${row.body}/${row.pose}/${row.anatomy}`;

/** Numeric failure reports remain visible even when a regression budget passes. */
export function smokeReport(rows: readonly SuiteRow[]) {
  const rest = rows.filter((row) => row.pose === REST_POSE);
  const posed = rows.filter((row) => row.pose !== REST_POSE);
  const failures = (selected: readonly SuiteRow[]) =>
    selected.filter((row) => !rowPasses(row.measure)).map(smokeRowKey);
  const restFailKeys = failures(rest);
  const posedFailKeys = failures(posed);
  const hardGateFailKeys = failures(
    rows.filter((row) => APPROVED_SMOKE_POSE_FAMILIES.includes(row.pose)),
  );
  return {
    restRows: rest.length,
    restFailCount: restFailKeys.length,
    restFailKeys,
    posedRows: posed.length,
    posedFailCount: posedFailKeys.length,
    posedFailKeys,
    hardGateFailKeys,
  };
}

export function smokeSummary(rows: readonly SuiteRow[]): string {
  const report = smokeReport(rows);
  return [
    `REST FAIL: ${report.restFailCount}/${report.restRows}`,
    `POSED FAIL: ${report.posedFailCount}/${report.posedRows}`,
    ...report.posedFailKeys,
    `Approved hard-gated pose families: ${APPROVED_SMOKE_POSE_FAMILIES.join(", ")}`,
    "A passing regression budget does not establish posed acceptance.",
  ].join("\n");
}
