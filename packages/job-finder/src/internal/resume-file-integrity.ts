/** The saved digest binds file bytes to the imported or approved resume. */
export function savedResumeDigestMatches(
  expected: string | null | undefined,
  actual: string,
): boolean {
  return Boolean(expected && actual.toLowerCase() === expected.toLowerCase());
}
