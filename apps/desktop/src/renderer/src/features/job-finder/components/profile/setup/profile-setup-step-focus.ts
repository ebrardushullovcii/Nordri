export const PROFILE_SETUP_STEP_HEADING_ID =
  "profile-setup-current-step-heading";

export function focusProfileSetupStepHeading(
  documentRef: Document = document,
  advancing = false,
): boolean {
  const activeElement = documentRef.activeElement;
  if (
    !advancing &&
    activeElement instanceof HTMLElement &&
    activeElement !== documentRef.body &&
    activeElement.isConnected
  ) {
    return false;
  }

  const stepHeading = documentRef.getElementById(PROFILE_SETUP_STEP_HEADING_ID);

  if (!stepHeading) {
    return false;
  }

  stepHeading.focus({ preventScroll: true });
  if (advancing) stepHeading.scrollIntoView({ block: "start" });
  return true;
}
