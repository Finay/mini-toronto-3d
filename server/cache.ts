export interface Cached<T> {
  value: T;
  /** Epoch milliseconds at which the value was loaded. */
  fetchedAt: number;
  /** True when the loader failed and this is the previous value. */
  stale: boolean;
}

/**
 * Wraps a loader so it runs at most once per `ttlMs`, shares one in-flight
 * call between concurrent callers, and falls back to the last good value when
 * the loader fails. Rejects only if there has never been a good value.
 */
export function cached<T>(
  ttlMs: number,
  load: () => Promise<T>,
  now: () => number = Date.now,
): () => Promise<Cached<T>> {
  let last: { value: T; fetchedAt: number } | undefined;
  let inFlight: Promise<Cached<T>> | undefined;

  return () => {
    if (last && now() - last.fetchedAt < ttlMs) {
      return Promise.resolve({ ...last, stale: false });
    }
    inFlight ??= load()
      .then(
        (value) => {
          last = { value, fetchedAt: now() };
          return { ...last, stale: false };
        },
        (error: unknown) => {
          if (last) return { ...last, stale: true };
          throw error;
        },
      )
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}
