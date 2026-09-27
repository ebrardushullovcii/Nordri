/**
 * One process-local order for final sends and additive authority changes.
 * Explicit revocation is intentionally outside this gate so it can veto a
 * send that is already checking the employer page.
 */
const tails = new WeakMap<object, Promise<void>>();
const successors = new WeakMap<object, Map<string, string>>();

export async function withApplicationAuthorityGate<T>(
  repository: object,
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T | null> {
  if (signal?.aborted) return null;
  const previous = tails.get(repository) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  tails.set(repository, tail);
  void tail.then(() => {
    if (tails.get(repository) === tail) tails.delete(repository);
  });

  try {
    const acquired = await new Promise<boolean>((resolve) => {
      if (signal?.aborted) {
        resolve(false);
        return;
      }
      const onAbort = () => resolve(false);
      signal?.addEventListener("abort", onAbort, { once: true });
      void previous.then(
        () => {
          signal?.removeEventListener("abort", onAbort);
          resolve(!signal?.aborted);
        },
        () => {
          signal?.removeEventListener("abort", onAbort);
          resolve(!signal?.aborted);
        },
      );
    });
    return acquired && !signal?.aborted ? await operation() : null;
  } finally {
    release();
  }
}

/** Only replacements made by this process may carry a prepared page forward. */
export function recordApplicationAuthoritySuccessor(
  repository: object,
  previousId: string,
  nextId: string,
): void {
  const chain = successors.get(repository) ?? new Map<string, string>();
  chain.set(previousId, nextId);
  // Keep a bounded trail for active pages. A restart drops those pages too.
  while (chain.size > 1_000) chain.delete(chain.keys().next().value!);
  successors.set(repository, chain);
}

export function resolveApplicationAuthoritySuccessorId(
  repository: object,
  originalId: string,
): string {
  const chain = successors.get(repository);
  let current = originalId;
  const seen = new Set<string>();
  while (chain?.has(current) && !seen.has(current)) {
    seen.add(current);
    current = chain.get(current)!;
  }
  return current;
}
