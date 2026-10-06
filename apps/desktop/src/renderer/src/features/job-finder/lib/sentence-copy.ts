export function joinUniqueSentences(values: readonly string[]): string {
  const seen = new Set<string>();
  return values
    .flatMap((value) => value.split(/(?<=[.!?])\s+/u))
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.replace(/[.!?]+$/u, "").toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((value) => (/[.!?]$/u.test(value) ? value : `${value}.`))
    .join(" ");
}
