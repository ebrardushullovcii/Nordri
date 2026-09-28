const LEGACY_PREFIX = "unemployed.";
const CURRENT_PREFIX = "nordri.";

/**
 * Preferences saved before the Nordri rename (ADR 0040) use the "unemployed."
 * prefix and the "interview-helper" module name. Copy each one to its current
 * key once, without overwriting a value saved under the new name.
 */
export function migrateLegacyStorageKeys(storage: Storage): void {
  const legacyKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(LEGACY_PREFIX)) legacyKeys.push(key);
  }

  for (const legacyKey of legacyKeys) {
    const key = `${CURRENT_PREFIX}${legacyKey.slice(LEGACY_PREFIX.length)}`.replace(
      "interview-helper",
      "live-assistant",
    );
    const value = storage.getItem(legacyKey);
    if (value !== null && storage.getItem(key) === null) {
      storage.setItem(key, value);
    }
    storage.removeItem(legacyKey);
  }
}
