// The build settings the app reads (spec section 4.9). Both are optional: without them the app
// uses the live Feed and its media bucket (src/feed/feed-urls.ts).
interface ImportMetaEnv {
  readonly VITE_FEED_ORIGIN?: string;
  readonly VITE_MEDIA_ORIGIN?: string;
}
