/** Parse output intent before running expensive geometry. Review references are claims, not verification. */
export function foundationSmokeOutput(args: readonly string[]) {
  let outputDir: string | undefined;
  let reviewReference: string | undefined;
  let updateBaseline = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--update-reviewed-baseline") updateBaseline = true;
    else if (arg === "--output-dir" || arg === "--review-reference") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--output-dir") outputDir = value;
      else reviewReference = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (updateBaseline && (!reviewReference || outputDir))
    throw new Error("Baseline update requires --review-reference and cannot use --output-dir");
  if (!updateBaseline && reviewReference)
    throw new Error("--review-reference requires --update-reviewed-baseline");
  return { updateBaseline, outputDir, reviewReference };
}
