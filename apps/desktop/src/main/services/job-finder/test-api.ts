import {
  BrowserSessionStatusSchema,
  type BrowserSessionStatus,
} from "@nordri/contracts";
import {
  isDisabled,
  isEnabled,
  normalizeFlagValue,
} from "./env-flags.mjs";

export { isDisabled, isEnabled, normalizeFlagValue };

export interface ResumeImportPathPayload {
  sourcePath: string;
  useVision?: boolean;
}

export type ResumePreviewTestMode = "ok" | "fail_once";

const warnedInvalidEnvValues = new Set<string>();

export function resetInvalidBooleanEnvWarnings() {
  warnedInvalidEnvValues.clear();
}

function warnInvalidEnvValue(
  variableName: string,
  configuredValue: string,
  fallbackDescription: string,
) {
  const normalizedConfiguredValue = normalizeFlagValue(configuredValue);
  if (normalizedConfiguredValue == null) {
    return;
  }
  const warningKey = `${variableName}:${normalizedConfiguredValue}`;
  if (warnedInvalidEnvValues.has(warningKey)) {
    return;
  }

  warnedInvalidEnvValues.add(warningKey);
  console.warn(
    `[desktop test-api] Unrecognized ${variableName} value: ${JSON.stringify(configuredValue)}. Falling back to ${fallbackDescription}.`,
  );
}

export function isDesktopTestApiEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnabled(env.NORDRI_ENABLE_TEST_API);
}

export function isBrowserAgentEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const configuredValue = env.NORDRI_BROWSER_AGENT;
  const normalizedValue = normalizeFlagValue(configuredValue);

  if (normalizedValue == null) {
    return true;
  }

  if (isDisabled(normalizedValue)) {
    return false;
  }

  if (isEnabled(normalizedValue)) {
    return true;
  }

  warnInvalidEnvValue(
    "NORDRI_BROWSER_AGENT",
    normalizedValue,
    "the default enabled behavior",
  );
  return true;
}

export function isBrowserHeadlessEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnabled(env.NORDRI_BROWSER_HEADLESS);
}

export function parseResumeImportPathPayload(
  payload: unknown,
): ResumeImportPathPayload {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("sourcePath" in payload) ||
    typeof payload.sourcePath !== "string" ||
    payload.sourcePath.trim().length === 0
  ) {
    throw new Error(
      "A non-empty sourcePath string is required for scripted resume import.",
    );
  }

  const maybeUseVision = (payload as { useVision?: unknown }).useVision;

  return {
    sourcePath: payload.sourcePath.trim(),
    ...(typeof maybeUseVision === "boolean"
      ? { useVision: maybeUseVision }
      : {}),
  };
}

function readTrimmedEnvValue(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

export function getResumePreviewTestMode(
  env: NodeJS.ProcessEnv = process.env,
): ResumePreviewTestMode {
  const configuredValue = readTrimmedEnvValue(env.NORDRI_TEST_RESUME_PREVIEW);

  if (configuredValue == null) {
    return "ok";
  }

  if (configuredValue === "ok" || configuredValue === "fail_once") {
    return configuredValue;
  }

  warnInvalidEnvValue(
    "NORDRI_TEST_RESUME_PREVIEW",
    configuredValue,
    'the default "ok" behavior',
  );

  return "ok";
}

export function getTestBrowserSessionStatus(
  env: NodeJS.ProcessEnv = process.env,
): BrowserSessionStatus | null {
  const configuredValue = readTrimmedEnvValue(
    env.NORDRI_TEST_BROWSER_SESSION_STATUS,
  );

  if (configuredValue == null) {
    return null;
  }

  const parsedStatus = BrowserSessionStatusSchema.safeParse(configuredValue);

  if (parsedStatus.success) {
    return parsedStatus.data;
  }

  warnInvalidEnvValue(
    "NORDRI_TEST_BROWSER_SESSION_STATUS",
    configuredValue,
    "the default no-override behavior",
  );

  return null;
}

export function getTestBrowserSessionLabel(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return readTrimmedEnvValue(env.NORDRI_TEST_BROWSER_SESSION_LABEL);
}

export function getTestBrowserSessionDetail(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return readTrimmedEnvValue(env.NORDRI_TEST_BROWSER_SESSION_DETAIL);
}

export function getDesktopTestDelayMs(
  value: string | undefined,
  envVarName: string,
): number {
  const normalized = normalizeFlagValue(value);
  if (normalized == null) {
    return 0;
  }

  if (!/^\d+$/.test(normalized)) {
    warnInvalidEnvValue(envVarName, normalized, "the default disabled behavior");
    return 0;
  }

  const parsed = Number.parseInt(normalized, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
