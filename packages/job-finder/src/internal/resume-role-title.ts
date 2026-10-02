export const importedRoleWordPattern =
  /\b(?:engineer|developer|designer|manager|director|analyst|consultant|specialist|architect|administrator|co-op|coordinator|assistant|officer|lead|support|scientist|intern|clerk|representative)\b/i;
const organizationMarkerPattern =
  /\b(?:Inc|LLC|Ltd|GmbH|Corp|Co|University|College|Company|Corporation)\b/i;

/** Split an employer suffix without mistaking a comma specialty for one. */
export function splitRoleTitleAndEmployer(
  value: string,
  hasSeparateCompany = false,
): {
  title: string;
  companyName: string | null;
} {
  const match = value.trim().match(/^(.+?)\s+at\s+(.+)$|^([^,]+),\s*(.+)$/i);
  const title = (match?.[1] ?? match?.[3] ?? "").trim();
  const employer = (match?.[2] ?? match?.[4] ?? "").trim();
  return match &&
    (match[1] !== undefined ||
      (importedRoleWordPattern.test(title) &&
        (!hasSeparateCompany || organizationMarkerPattern.test(employer))))
    ? { title, companyName: employer || null }
    : { title: value.trim(), companyName: null };
}
