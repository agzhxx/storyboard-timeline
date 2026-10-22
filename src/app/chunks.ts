// Lazily loaded chunks that can be loaded again after a failure. A chunk
// that didn't load (offline, the connection dropped) is tried again the next time it's wanted,
// without a reload. Chrome keeps a failed module fetch for the life of the page and fails every
// later import of that address at once; Safari fetches again (both checked with Playwright). So a
// retry imports the chunk's own address with a query added, which is a new module to the browser.
// The address comes from the error, which Chrome and Firefox name it in; Safari's error doesn't,
// and there the same import is tried again.

/** A chunk's address, as the browser's error names it. */
export function chunkAddress(error: unknown): string | null {
  return /https?:\/\/[^\s"'<>]+?\.js\b/.exec(String(error))?.[0] ?? null;
}

/**
 * A loader for a chunk (`load` is its `import()`): the module once it's in, else a new try at
 * each call. `retry` imports an address; the tests give it a fake one.
 */
export function chunk<T>(
  load: () => Promise<T>,
  retry: (address: string) => Promise<T> = (address) =>
    import(/* @vite-ignore */ address) as Promise<T>,
): () => Promise<T> {
  let loading: Promise<T> | null = null;
  let failedAddress: string | null = null;
  let tries = 0;
  return () => {
    if (loading) return loading;
    const address = failedAddress;
    if (address !== null) tries += 1;
    const attempt = address === null ? load() : retry(`${address}?retry=${tries}`);
    loading = attempt;
    attempt.catch((error: unknown) => {
      loading = null;
      failedAddress = chunkAddress(error) ?? failedAddress;
    });
    return attempt;
  };
}
