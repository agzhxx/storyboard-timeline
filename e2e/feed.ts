// The Feed and its media in the end-to-end tests (spec section 5), routed to fixtures so the tests
// never touch the network. The API answers from the Feed's real answer for the story
// (fixtures/feed/story.json), paged by cursor like the real one; other collections get clips made
// from the story's. Every clip address, a 1080p original or a 720p file, serves story-shot.mp4
// with range requests, as R2 does, and every poster a fixture image. The answers carry the CORS
// headers the Feed's API and its bucket send. Any other outside request is refused. In WebKit, the
// two media workers take turns (below).

// The function passed to page.addInitScript runs in the page, with the DOM.
/// <reference lib="dom" />

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Page, type Route, test } from "@playwright/test";

const FEED = "https://generation-feed.vercel.app";
const MEDIA = "https://pub-b6efd72fde71478fa4b96c65e2f0928d.r2.dev";
const FIXTURES = join(import.meta.dirname, "fixtures");

type Item = Record<string, unknown> & { id: string };

const story = (
  JSON.parse(readFileSync(join(FIXTURES, "feed", "story.json"), "utf8")) as {
    items: Item[];
  }
).items;
const clip = readFileSync(join(FIXTURES, "story-shot.mp4"));
const poster = readFileSync(join(FIXTURES, "feed", "poster.jpg"));

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "content-length, content-range, accept-ranges, etag",
};

/** `count` clips of another collection, made from the story's with new ids and no shot. */
function collectionOf(collection: string, count: number): Item[] {
  return Array.from({ length: count }, (_, index) => {
    const item: Item = { ...(story[index % story.length] ?? { id: "0000000000" }) };
    Reflect.deleteProperty(item, "shot");
    const id = `${String(index).padStart(2, "0")}${item.id.slice(2)}`;
    return { ...item, id, collection, posterKey: `m/${id}/v1`, videoKey: `m/${id}/v1/full.mp4` };
  });
}

export interface FeedRoutes {
  /** Whether the API answers; false refuses every request, as an unreachable Feed does. */
  apiUp: boolean;
  /** The API's addresses asked for, in order. */
  requests: string[];
}

/**
 * Routes the Feed's API and media to the fixtures for this page; `others` gives other collections
 * their number of clips (none by default). The returned object turns the API off and on.
 */
export async function routeFeed(
  page: Page,
  { others = {} }: { others?: Record<string, number> } = {},
): Promise<FeedRoutes> {
  const routes: FeedRoutes = { apiUp: true, requests: [] };
  if (inWebKit()) await filmstripsAfterFirstPicture(page);
  // Routes run newest first: this catch-all goes first, so the two below come before it. Only
  // requests over the network: WebKit routes a worker's reads of its own files too, as blob: loads,
  // which have no host (the save worker reads its saves that way).
  await page.route(
    (url) =>
      url.protocol.startsWith("http") &&
      url.hostname !== "localhost" &&
      url.hostname !== "127.0.0.1",
    (route) => route.abort("blockedbyclient"),
  );
  await page.route(`${FEED}/api/media?**`, (route) => {
    routes.requests.push(route.request().url());
    if (!routes.apiUp) return route.abort("failed");
    return answerPage(route, others);
  });
  await page.route(`${MEDIA}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith(".mp4")) return ranged(route, clip, "video/mp4");
    if (pathname.endsWith(".webp")) return ranged(route, poster, "image/jpeg");
    return route.fulfill({ status: 404, headers: CORS });
  });
  return routes;
}

/** Whether this test runs in WebKit. */
export function inWebKit(): boolean {
  return test.info().project.name === "webkit";
}

/**
 * CI's Linux WebKit now and then hangs, or crashes, when both media workers start decoding at once,
 * as they do the moment a Feed clip is placed: the decode worker for the monitor's picture, the
 * import worker for the clip's filmstrip (its GStreamer media stack). So in
 * WebKit, a page's filmstrip requests wait for the decode worker's first answer: the two take
 * turns. Chrome decodes in both at once, as people's browsers do.
 */
async function filmstripsAfterFirstPicture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const held: (() => void)[] = [];
    let holding = true;
    const typeOf = (message: unknown): unknown =>
      typeof message === "object" && message !== null && "type" in message ? message.type : null;

    class TakingTurns extends Worker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event: MessageEvent<unknown>) => {
          const type = typeOf(event.data);
          if (!holding || (type !== "still" && type !== "still-failed")) return;
          holding = false;
          for (const send of held.splice(0)) send();
        });
      }

      override postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ): void {
        const send = () => {
          super.postMessage(message, options as StructuredSerializeOptions);
        };
        if (holding && typeOf(message) === "remote-thumbnails") held.push(send);
        else send();
      }
    }
    window.Worker = TakingTurns;
  });
}

/** One page of a collection, after its cursor ("c<index>"), as `/api/media` pages. */
function answerPage(route: Route, others: Record<string, number>) {
  const params = new URL(route.request().url()).searchParams;
  const collection = params.get("collection") ?? "";
  const items = collection === "story" ? story : collectionOf(collection, others[collection] ?? 0);
  const limit = Number(params.get("limit") ?? 40);
  const from = Number(/^c(\d+)$/.exec(params.get("cursor") ?? "")?.[1] ?? 0);
  const next = from + limit < items.length ? `c${String(from + limit)}` : null;
  return route.fulfill({
    status: 200,
    headers: { ...CORS, "content-type": "application/json" },
    body: JSON.stringify({
      items: items.slice(from, from + limit),
      nextCursor: next,
      total: items.length,
    }),
  });
}

/** A file as R2 serves it: the whole of it, or the byte range asked for. */
function ranged(route: Route, body: Buffer, type: string) {
  const headers = { ...CORS, "content-type": type, "accept-ranges": "bytes" };
  const asked = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? "");
  if (!asked) {
    return route.fulfill({
      status: 200,
      headers: { ...headers, "content-length": String(body.length) },
      body,
    });
  }
  const start = Number(asked[1]);
  const end = asked[2] ? Math.min(Number(asked[2]), body.length - 1) : body.length - 1;
  if (start >= body.length) {
    return route.fulfill({
      status: 416,
      headers: { ...CORS, "content-range": `bytes */${String(body.length)}` },
    });
  }
  return route.fulfill({
    status: 206,
    headers: {
      ...headers,
      "content-range": `bytes ${String(start)}-${String(end)}/${String(body.length)}`,
      "content-length": String(end - start + 1),
    },
    body: body.subarray(start, end + 1),
  });
}
