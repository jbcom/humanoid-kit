/** Whether two numeric records (or both absent) hold the same keys and values. */
export function sameEntries(
  a: Readonly<Record<string, number>> | undefined,
  b: Readonly<Record<string, number>> | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const keys = Object.keys(b);
  return (
    Object.keys(a).length === keys.length &&
    keys.every((k) => Object.hasOwn(a, k) && Object.is(a[k], b[k]))
  );
}
