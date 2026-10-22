// Media read from an address (spec section 4.5): Mediabunny's UrlSource asks for the bytes it needs
// with range requests (`Range: bytes=N-`), so a clip from the Feed is read where it's stored, never
// copied. Both workers open remote media through here, and tell a failure of the network (no
// answer, an error status) from one of the media itself, which the editor reports differently.

import { UrlSource } from "mediabunny";

/** How long a server may take to start answering a request (r2.dev answers in well under 1 s). */
export const ANSWER_TIMEOUT_MS = 10_000;

/** The server didn't answer in time, or answered with an error that a later try may not get. */
export class UnreachableError extends Error {}

/**
 * How long to wait before asking again after a request fails, in seconds; null gives up. Two
 * more tries, half a second and a second later, ride out a blip. Mediabunny's own default keeps
 * trying forever in a worker, where it can't tell a CORS refusal from a dropped connection: the
 * Feed tab, the story and playback would wait on an answer that never comes.
 */
export function retryDelay(previousAttempts: number): number | null {
  return previousAttempts <= 2 ? previousAttempts * 0.5 : null;
}

/**
 * fetch, for Mediabunny: an error status a later try may not get (429 for r2.dev's rate limit,
 * 5xx) throws, so it's retried like a dropped connection (Mediabunny retries only what throws),
 * and a server that hasn't started answering after 10 s is given up on. Once the answer starts,
 * its body takes as long as it takes.
 */
export async function answeringFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const late = new AbortController();
  const timer = setTimeout(() => {
    late.abort(new UnreachableError("No answer in time"));
  }, ANSWER_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, late.signal]) : late.signal;
  try {
    const response = await fetch(input, { ...init, signal });
    if (response.status === 429 || response.status >= 500) {
      throw new UnreachableError(`The server answered ${String(response.status)}`);
    }
    return response;
  } catch (error) {
    throw late.signal.aborted ? new UnreachableError("No answer in time") : error;
  } finally {
    clearTimeout(timer);
  }
}

/** A source for the media at `url`. */
export function remoteSource(url: string): UrlSource {
  return new UrlSource(url, { getRetryDelay: retryDelay, fetchFn: answeringFetch });
}

/** The messages browsers give a fetch that got no answer: offline, refused, or blocked by CORS. */
const NO_ANSWER = /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource)/;

/**
 * Whether reading media failed for the network's sake, not the media's: no answer (offline, a
 * refused connection, a CORS refusal), no answer in time, or an error status (Mediabunny's "Error
 * fetching …", such as a 404). A clip that failed this way may load on the next try.
 */
export function unreachable(error: unknown): boolean {
  if (error instanceof UnreachableError) return true;
  if (error instanceof TypeError) return NO_ANSWER.test(error.message);
  return error instanceof Error && error.message.startsWith("Error fetching ");
}
