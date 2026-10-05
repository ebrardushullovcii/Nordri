import { describeFailure } from "../../lib/describe-failure";

/** Keep recorded plain reasons; replace browser logs with a readable failure. */
export function discoverySourceFailureCopy(reason: string | null): string {
  if (!reason?.trim()) return "This source could not finish. Try again.";
  if (/page\.|Call log:/u.test(reason) || reason.includes("\u001b"))
    return describeFailure(reason).sentence;
  return reason.trim().split("\n")[0]!;
}
