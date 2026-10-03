/** Compare saved facts across sentences and bullets without treating a new metric as a paraphrase. */
export function resumeSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}%+#]+/gu, " ")
      .split(/\s+/u)
      // "pensions app" and "pension-app" are the same fact.
      .map((word) =>
        word.length > 4 && word.endsWith("s") && !word.endsWith("ss")
          ? word.slice(0, -1)
          : word,
      )
      .filter(
        (word) =>
          word.length > 2 &&
          ![
            "the",
            "for",
            "and",
            "with",
            "from",
            "into",
            "was",
            "were",
          ].includes(word),
      ),
  );
}

export function resumeFactIsCovered(
  fact: string,
  content: readonly string[],
): boolean {
  const factTokens = tokens(fact);
  if (!factTokens.size) return false;
  const numbers = (text: string) =>
    text
      .match(/\d+(?:[.,]\d+)?\s*%?/gu)
      ?.map((value) => value.replace(/\s+/gu, "")) ?? [];
  return content.flatMap(resumeSentences).some((line) => {
    const lineTokens = tokens(line);
    const normalized = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
    if (normalized(line).includes(normalized(fact))) return true;
    if (factTokens.size < 4) return false;
    if (numbers(fact).some((number) => !numbers(line).includes(number)))
      return false;
    if (
      /\b(?:not|never|without)\b/iu.test(fact) !==
      /\b(?:not|never|without)\b/iu.test(line)
    )
      return false;
    return (
      [...factTokens].filter((word) => lineTokens.has(word)).length /
        factTokens.size >=
      0.75
    );
  });
}
