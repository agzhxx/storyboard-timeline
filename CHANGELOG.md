# Changelog

## The Feed tab's cards from Genframe (2026-10-21)

- The Feed tab's cards are Genframe's `MediaCard`, installed from the Kit's registry with
  `shadcn add` (`components.json`, an `@/` alias for the Kit's files, a four-line `cn`, shadcn's
  color names mapped onto our tokens). Same name, description, drag and Enter; a ThumbHash under
  each poster until it loads, and the Kit's outline on hover.
- The Feed tab stays a chunk of its own: 2.6 → 6.3 KB gzip; first-load JS unchanged at 114.5 KB of
  120 (`docs/PERF.md`).

## M8 · Measure and present (2026-10-19)

- `pnpm bench`: one command that builds the app, serves it on 4173 (or 5173: the Feed's bucket
  reads from no other local address), checks it's this build, runs the editing, import, playback
  and export benches one after another, each alone, and adds a dated table with the machine and the
  browser's version to `docs/PERF.md`. Each bench keeps its own command, and every bench now runs
  in Playwright's WebKit and Firefox engines too (`webkit`, `firefox`), labeled as engines.
- The worst number, chosen by measuring: the first visit's filmstrips, 16.3 s before every clip
  had the thumbnails the cut shows. A Feed clip's first thumbnails now come from the Feed's preview
  of it (its first 2.5 s at 480p, about 170 KB, where the 720p file is 1.6 MB with one key frame),
  three clips at a time, every clip's before any clip's 720p file. The cut's filmstrips: 14.0–17.6 s
  before, 2.9–4.9 s after, over three rounds with the builds taking turns. A Feed asset carries its
  preview's address; saves from before still read back.
- First-load JS 115.7 KB → 114.5 KB of 120: no modulepreload polyfill (every supported browser
  preloads modules), and the Feed tab's clips in a chunk of their own, fetched when the pointer or
  the keyboard reaches the tab; if it won't load, the panel says so, with Retry.
- `/?demo=story`, for the Feed's "Open in Timeline": the robot story loads into an empty project; a
  cut that's there stays, and a toast offers New project. The parameter leaves the address.
- The browser matrix: the benches and the end-to-end suite in Chrome and in Playwright's WebKit and
  Firefox engines. All three run the whole editor, and every export passes its check. Firefox's
  engine exports WebM (it has no AAC encoder), at 0.3× real time at 1080p (its VP9 encoder), and
  reaches the exact frame on 1080p files in 343 ms at p95; WebKit's drops up to 0.9 % of a
  two-track 1080p cut's frames. `pnpm test:e2e:firefox` runs the suite there (59 pass, 6 skipped by
  design).
- The README is the case study: the pitch, the live link, the three
  headline numbers, the problem, the approach, an architecture diagram (Mermaid), three decisions
  with what they beat, the numbers per browser, tests and accessibility, failure states, prior art,
  and credits and licenses.
- Demo clips: four silent clips recorded by `scripts/record-clips.ts` (a scrub, a snapping trim, a
  split with its undo, an export), as MP4s for posts (kept out of git) and animated WebPs for the
  README.
- MIT license.
- 11 more unit and component tests (902 in all): the preview's thumbnails, the two rounds three at
  a time, previews that fail or stop early, saves without a preview's address, a Feed tab whose
  chunk won't load, the picker's choice checked in the store, and `?demo=story`. 8 more end-to-end
  runs (130 in all, in Chrome and WebKit: 124 pass, 6 are skipped by design): `?demo=story` into an
  empty project and over a saved cut, a Feed clip's thumbnails kept for later sessions only once
  every one is stored, and a check that every lazy chunk imports from the shell alone.
- An independent review before merging found, and this milestone fixes: a Feed clip's stored
  thumbnails counted complete when a file was there but its write had failed (the 720p job now
  stores them all and writes meta.json only when every write of its own succeeded; measured after
  it, every clip's thumbnails and a 720p export right after a first visit came sooner too), a
  bench's CPU slowdown that reading the heap could end (one DevTools session per page now), and a
  line on what only Chrome measures. It also flagged the collections chunk
  two lazy chunks shared, fixed by then (the picker's choice checked in the store, and the chunk
  check).

## M7 · Saving, states, accessibility, phone view (2026-10-19)

- Autosave: the project and the view (playhead, zoom, scroll) are written to this browser's private
  storage half a second after a change (a second for the view alone, at once when the page is left
  or hidden), by a save worker with sync access handles, taking turns between two slots, each with
  a number one higher than the last. A save cut short can only damage the older slot. At startup
  the worker reads both back and keeps the newest that passes the save's zod schema and the
  document's rules, before the editor shows; Feed clips come back from what the save holds, without
  asking the Feed, and a file whose copy is gone shows that it's missing. The app bar says "Saving…",
  "Saved", "Restored from this browser" or "Not saved: storage is full", with the board's toast;
  the last good save stays. Persistent storage is asked for once, after the first real save.
- One tab edits the project at a time (a Web Lock): another tab says so, waits, and can take it
  over with Use it here.
- New project, with the board's confirmation, clears the saves, My files and the caches. A ready file
  no clip uses can be removed from My files (M3's gap).
- Offline: editing goes on and saves; the Feed tab shows the board's note and dims the clips that
  need a connection; filmstrips, the Feed's page and lazily loaded chunks load again once the
  connection is back, without a reload (Chrome keeps a failed module fetch, so a retry asks for the
  chunk with a query). Reduced motion: every transition is timed by the motion tokens, now tested.
- Keyboard: a selected clip's trim handles are W3C sliders in the Tab order, with a timecode value
  and what holds them; arrows trim a frame, Shift a second, Home and End to the limit; Alt with the
  arrows nudges the clip; a held key is one undo step. Focus follows a split and a delete. The "?"
  dialog lists the board's shortcuts and the new ones; focus stays inside and Esc closes it.
- One polite live region says each edit, undo and redo in the "Undo: …" chip's words, the toasts,
  the Feed tab's news and save problems; errors that stop work stay alerts.
- The phone view, under 768 px, its own chunk: the saved cut plays, as the Phone board draws it,
  and with nothing saved it offers the robot story.
- Fixed on the way: a keyboard trim down to a very narrow clip took away the focused handle;
  filmstrip jobs queued before New project wrote into the cleared storage; axe's WCAG 2.2
  target-size rule flagged the 6 px sliders, so a selected clip's handles take presses 24 px across
  (drawn 6 px as before).
- Fixed after an independent review: a video placed while its thumbnails were made lost its copy
  if the tab closed before they were done (`meta.json` now comes with every copy, and cut-short
  thumbnails are made again at the next start); storage that hung at startup kept the editor from
  showing, and storage the page couldn't open was taken for none, so autosave could write over a
  good save; a restore that failed is now an alert, and New project asks before deleting saves it
  never opened; Use it here clicked twice took the project from its own tab; filmstrip jobs New
  project dropped came back at the next reconnect; Esc on a focused trim handle lost the focus; New
  project in a browser that won't store files said it couldn't remove everything; an undo then a
  redo joined the next held-key press to the redone step. New project's saves are numbered after
  the old project's, so a slot it couldn't delete never comes back in their place.
- 110 more unit and component tests (891 in all): saves, slot choice, damaged and other-version
  saves, the quota path, the lock, persistence, chunk retries, the announcement texts, keyboard
  trims and nudges at their limits as one undo step, the sliders' ARIA, the save status, the
  dialogs, the offline tab, reduced motion and the phone view. 34 more end-to-end runs (122 in all),
  in Chrome and WebKit: spec test 9 (a reload keeps the story, a file and the view), test 11 (the
  phone view plays), test 12 (axe, WCAG 2.0 to 2.2 A and AA: no serious or critical issue on the
  empty project, the story, both dialogs, the export dialog and the phone view), a whole edit with
  the keyboard alone, New project, offline, storage full, a second tab, storage that hangs or that
  the page can't open, a browser that won't store files, and a video whose thumbnails a reload cut
  short.
- First-load JS 115.7 KB of 120 (one file: a Rolldown group keeps everything loaded at the start
  together, which saved 1.9 KB); the phone view, the dialogs and the save worker are their own
  chunks. Editing with saving on keeps 60 FPS with no long animation frame, at 1× and 4× CPU; a
  save takes at most 1 ms of the main thread (`docs/PERF.md`).

## M6 · Export (2026-10-19)

- Export, from the toolbar: a modal dialog, as the Export boards draw it. Settings: 1080p or 720p,
  the project's frame rate, the format this browser can encode and the file's estimated size.
  The format is asked of the browser, never read from its name: MP4 (H.264 and AAC) where both
  encode, else WebM (VP9 and Opus) with a note saying why, else none at that size. Exporting: the
  frame being encoded twice a second, the progress, the time left from a smoothed rate, and
  Cancel. Done: the film's first frame, its name (`the-robot-story.mp4`), size and length, the
  output check, and Download. Export works from a snapshot of the project, pauses playback, and
  the editor's keys wait behind the dialog: an export never changes the project.
- The export worker (`src/media/export.worker.ts`, its own chunk): each output frame at the
  project's rate, V1 then V2, fitted over black on an OffscreenCanvas, into Mediabunny's
  CanvasSource at a fixed bitrate (6.5 Mbit/s at 1080p, 3 at 720p), awaiting each add for
  backpressure. Each clip is decoded once, forward, from its in point, and the next clip's pass
  starts early so its reads overlap the encoding. A 1080p export reads the Feed's originals by
  range, only the seconds the cut uses; 720p reads the Feed's 720p files; your files come from
  storage. The music is mixed on the main thread with an OfflineAudioContext (Web Audio isn't in
  workers) and encoded as AAC or Opus; a cut without music has no audio track.
- The output check, in the worker on the finished file: its first and last frames decode and its
  picture is the cut's length within a frame, on the done screen and in the `?perf=1` overlay. It
  caught Chrome's AAC priming: the music came out 44 ms behind the picture, so the worker measures
  the encoder's delay with a click and times the music that much earlier; the MP4's edit list
  skips the priming, and a click at 1.000 s comes out at 1.000 s, in MP4 and in WebM.
- The board's failure states: "Export failed" with where the encoder (or a clip) stopped, details
  for a bug report and Try again; "Export canceled. Nothing was saved, and your project is
  unchanged." with Export again; "Export stopped: 07-medium couldn't be read from the Feed. …"
  with Retry. In a browser without video encoding, the toolbar's "Export unavailable" says why.
  A worker whose output can't be set up now says so instead of leaving the dialog waiting.
- The frame schedule (`src/engine/export-schedule.ts`) had its tests written first.
- Toasts take an action button ("Export again") and a problem said in one line; the editor's keys
  wait while a dialog is open; the perf overlay gets an "Export check" row, and its open-frame count
  includes the export worker's samples.
- An independent review before merging found, and this milestone fixes: a cancel that waited on
  the network, a queued export a cancel couldn't stop, a clip whose file starts after 0 failing,
  the dialog's focus on open and close, music that won't decode getting the network's toast,
  failures that stuck until a reload, and pictures from a canceled export left open. CI found one
  more: a cancel while the next frame was read released the frame before it twice.
- 124 more tests (781 unit and component tests in all): the schedule, the format chooser per
  browser, the estimate, the time left, the mix, the reader, the loop, the encoder's delay, the
  check, the file name and every dialog state with the boards' copy. 20 more end-to-end runs (88
  in all): spec test 8 in Chrome and WebKit (the film's first frame, decoded back, is the source
  frame the cut puts there; the browser's own player opens it, it lasts 3 s within a frame, and
  each of its 72 frames is the cut's, except in CI's Linux WebKit, whose player reads frames back
  black), a click in the music landing at 1 s in the browser's own format (MP4 in Chrome on macOS,
  WebM on Linux, which has no AAC encoder) and in WebM, Cancel, a Feed original that won't load,
  Export unavailable and the WebM fallback.
- Measured (`pnpm bench:export`, `docs/PERF.md`): the 45 s story at 1080p in 22 s from the live
  Feed (2.0× real time; goal ≥ 1×), 6.0 s with its media local (7.5×), 720p in 3.4 s (13×); the
  network is the limit at 1080p, the hardware encoder with the media local. 145–147 MB received
  per 1080p export, for the 124 MB the cut decodes of the originals' 243. 0 open frames after
  every export. First-load JS 107.8 KB of 120.

## V2 over V1 in WebKit (2026-10-19)

- "V2 draws over V1" runs in WebKit again, so all six playback media tests run in both browsers. On
  CI's Linux WebKit, V2's frame, waiting for V1's, sometimes drew blank: a WebKit bug, found with a
  throwaway probe branch (59 failures in 180 runs). In WebKit, the test's page draws one pixel of
  each frame as it arrives, which avoids it (none in 70); the app doesn't change.

## M5 · The Feed and the demo (2026-10-18)

- The Feed's API client (`src/feed/`): the Feed's `mediaItemSchema`, copied at
  generation-feed@65a0341, checks every answer of `/api/media` (fields the copy doesn't know are
  dropped first); pages follow `nextCursor`; a page that doesn't come says why (no answer, a
  timeout, an error status, an answer the schema refuses). It and zod are their own 24.9 KB chunk,
  loaded with the Feed tab or the story. `VITE_FEED_ORIGIN` and `VITE_MEDIA_ORIGIN` default to the
  live Feed and its R2 bucket.
- The media bin's tabs, My files | From the Feed, as drawn (a tab list). From the Feed: the
  Collection picker (the story first, video collections only), cards with the poster, the AI badge,
  the length, the shot and the model, Add on hover and focus, a drag onto a track; pages of 24 as
  the list reaches its end; "Loading clips from the Feed…", "Can't reach the Feed" with Retry, and
  the footer "All 15 clips loaded · AI-generated, from the Generation Feed".
- Feed clips are read where they are, with range requests (Mediabunny's `UrlSource`), never copied:
  a clip's facts from its file's header before it's placed, its filmstrip from the Feed's 720p
  file (kept in OPFS by the item and its version, so it's back after a reload), and the monitor's
  exact frames and playback from the 720p file too, which meets the exact-frame goal over the
  network where the 1080p original doesn't (115 ms against 2,515 ms at p95); export will read the
  original.
- "Load the robot story" loads from the Feed: the 15 story clips on V1 in shot order, each with its
  first 3 s, the demo music on A1, a 45 s cut at the first file's frame rate; the button says it's
  loading, and a failure shows the board's toast, "Couldn't load the robot story", with Retry.
- Placeholder demo music, made with ffmpeg (`scripts/make-demo-music.sh`): 45 s at 80 beats a
  minute, one bar per shot, no license restrictions.
- The inspector says "From the Feed · Kling 2.5 Pro" with the AI badge; the demo music "Comes with
  the app · license in the README".
- A Feed clip whose file didn't load (no answer, r2.dev's rate limit, a server error) isn't a
  broken clip: error statuses are retried, a still shows its thumbnail and is asked for again, and
  playback pauses with "Couldn't load …" and Play again.
- The placeholder source, colors and story are gone.
- An independent review before merging found, and this milestone fixes: load failures shown as
  decode errors, a late page over the story's collection, a drop refused when the clip's facts
  came after it, one message for every story failure, Retry replacing a started cut, no timeout on
  the music's fetch, and loading text screen readers wouldn't announce.
- In the Feed's repo, its own PR (agzhxx/generation-feed#1): `Access-Control-Allow-Origin: *` on
  `/api/media`, with its cache headers. The bucket's CORS policy is set in Cloudflare.
- 93 more tests (657 unit and component tests in all): the schema on the Feed's real answer
  (saved as a fixture), paging and every failure, the URL helpers, the story's order, 3 s per shot,
  45 s and the first file's rate, the tab's pages, facts probed once, thumbnails from storage or the
  worker, and the tab's and the story's states with the board's copy. End-to-end, with the Feed
  routed to fixtures so CI never touches the network: spec test 2 on the Feed's story, the Feed tab
  and Add, pages, Can't reach the Feed, the story's failure toast, the inspector's label, and a Feed
  clip scrubbed to the exact frame and played, in Chrome and WebKit. In WebKit, the two media
  workers take turns as the story loads: CI's Linux WebKit hung in about one story test in eight
  when both started decoding at once.
- Measured on the real story from the live Feed (`pnpm bench:playback story`, `docs/PERF.md`): a
  picture while dragging in 14 ms p95 (goal 50), the exact frame in 84 ms p95 after the pointer
  rests (goal 200), 0 late frames in 5 play-throughs, 0 open frames when paused; the story loads in
  1.8 s. First-load JS 107.0 KB of 120.

## Media tests in WebKit (2026-10-18)

- M3's six media e2e tests (an MP4 and its filmstrip, WAV and MP3 waveforms, a 25 fps WebM, ProRes,
  a file dragged onto a track, My files after a reload) run in WebKit as well as Google Chrome.
  Each WebKit test gets a persistent context in a fresh temporary profile (`e2e/storage.ts`), since
  Playwright's default WebKit contexts have no file system to import into. None of the import
  tests is skipped, on macOS or on CI's Ubuntu runner.
- Five of M4's six playback media tests (spec test 7 in full, the scrub's Preview then exact frame,
  a decode error, open frames after two tracks and a 30 fps WebM) run in WebKit too, with the same
  fixture. The sixth, V2 over V1, skips WebKit for now: on CI's Linux WebKit, V2's exact frame
  sometimes never comes, and the cause isn't found yet.

## M4 · Preview and playback (2026-10-18)

- A decode worker (`src/media/decode.worker.ts`, its own 64 KB chunk) owns one Mediabunny Input per
  imported file, opened from OPFS. The main thread never decodes.
- The paused monitor shows the exact frame at the playhead, V2 over V1: an ImageBitmap at the
  monitor's size, latest wins (a newer request drops the waiting one and stops the one decoding;
  a stale answer is closed unseen), kept in a 64 MB cache of recent frames. The inspector shows the
  selected clip's exact in point.
- The two-stage scrub, as the boards draw it: while dragging the ruler (or holding an arrow key),
  the nearest thumbnail at once, marked "Preview"; when the pointer rests, the exact frame. A
  step or a jump keeps the last picture, dimmed with a spinner if the frame takes over 120 ms.
- Playback with the audio clock leading: A1's music plays through the shared AudioContext, and
  each animation frame shows each track's newest decoded frame that's due, V2 over V1. Each track
  decodes up to 8 frames ahead and waits for the main thread to hand frames back
  (backpressure); the next clip starts decoding a second before a cut. Late frames are skipped,
  never waited for. Without working audio the clock follows `performance.now()`.
- Space plays and pauses (a button reached with Tab keeps Space), L plays and again plays at 2×, K
  pauses, J goes back a second and keeps playing; ←/→, Shift+←/→, Home and End pause and step.
  The transport gets the round Play/Pause button and the rate chip. Playback stops at the end of
  the cut, turns the timeline's page as it plays, and pauses for an edit, a scrub, a jump or a
  hidden tab.
- A frame that won't decode pauses playback with the board's message ("Can't decode 10-wide
  here", "Paused at …", Play from the next clip); the clip keeps an error badge. Chrome doesn't
  throw on a cut-short file, so a clip also fails where its frames end early or skip.
- Frames are looked up 1 ms after they start, since WebM stores times in whole milliseconds and
  one frame in three would otherwise show the frame before.
- Every VideoFrame and VideoSample is counted and closed: the perf overlay shows the board's rows
  (open VideoFrames, each track's decode queue, late or dropped frames, the coarse and exact scrub
  latencies, FPS, long animation frames, JS heap), and open frames read 0 when paused.
- Imported music stays decoded for playback; after a reload it's decoded on its first play.
- An independent review before merging found, and this milestone fixes: a bitmap closed while V1
  and V2 drew the same frame, a decode message that outlived its deleted clip, a failure frame one
  too early at mixed frame rates, repeated and superseded inspector stills, stills not closed after
  the monitor unmounted, and two worker error paths that left a frame open.
- 118 more tests (564 unit and component tests in all), including the clock and its fallback
  with fakes, the frame queue and late accounting, backpressure and look-ahead, latest wins, the
  LRU, A1's scheduling and the decode-error reducer. End-to-end, in Chrome with fixtures whose
  frames paint their own index: spec test 7 in full, the scrub's Preview then exact frame, a decode
  error, open frames after two tracks, V2 over V1 and a 30 fps WebM; Space, K, L, J and the end of
  the cut in WebKit too.
- Measured with the new `pnpm bench:playback` (1080p H.264, two overlapping tracks and music,
  45 s), headless: a picture while dragging the ruler in 14 ms p95 (goal 50), the exact frame
  143 ms p95 after the pointer rests (goal 200), 0 late or dropped of 1,440 frames in each of 5
  play-throughs (also with the CPU slowed 4×), 0 open frames when paused, the heap flat at 5 MB.
  First-load JS 103.0 KB gzip of 120 KB; the decode worker is its own 64 KB chunk (`docs/PERF.md`).

## M3 · Import and analysis (2026-10-18)

- My files: add your own video (MP4, MOV, WebM) and music (MP3, M4A, WAV) with Add files, "Add your
  own files" or Choose files, or drop them on the bin; several at once, imported one after another.
  Each row shows its import as the board draws it: waiting, "Reading its length… can't be placed
  yet", "Copying 62%", ready with its poster and "0:05 · 1920 × 1080 · 24 fps" or "0:48 · MP3 ·
  stereo", or why it can't open, with Remove. A file can go on the timeline (click, Enter or a drag)
  once it's copied. A second import of the same file is skipped, with a toast.
- Files stay on this device: each is copied into the browser's private storage (OPFS) with its
  thumbnails, peaks and `meta.json`, and My files comes back after a reload without starting the
  worker.
- An import worker, started on the first import: Mediabunny reads the file and asks the browser
  whether it decodes it (canDecode, then a first frame), music decodes with decodeAudioData as
  playback will, the copy goes into OPFS through a sync access handle in 4 MB chunks, and a 160 px
  thumbnail is made per second. Mediabunny never loads on the main thread.
- Clear messages from the file's codec, never the browser's name: HEVC, 10-bit, any other codec by
  name, a file with no media, a damaged one, a full storage (the half copy is deleted), a file that
  moved away mid-import.
- Video clips show filmstrips and music clips waveforms (from min/max peaks of about a millisecond,
  one byte each, with coarser levels made on demand), drawn in 1,024 px tiles near the view and laid
  along the source, so a trim reveals or covers frames as drawn. Placeholders keep their colors.
- The first video on an empty project sets its frame rate, the nearest of 24, 25 and 30, in the
  same undo step as its clip.
- The monitor shows an imported video's nearest thumbnail ("Preview") and the inspector the one at
  the clip's in point, until M4 decodes frames.
- 138 new tests (446 unit and component tests in all). End-to-end: an MP4 with its filmstrip's
  pixels, WAV and MP3 waveforms, a WebM at 25 fps, ProRes (spec test 10), a file dragged onto a
  track and My files after a reload, in Chrome; a file that isn't media, files dragged over the bin
  and the picker in WebKit too. Fixtures made with ffmpeg (456 KB), with their script.
- An independent review before merging found, and this milestone fixes: copies left in storage by
  imports that failed after copying, filmstrip slots showing the last thumbnail loaded instead of
  staying empty, previews keeping another clip's picture, a queue that a hung decode could stop, a
  race with My files' startup read, and three tests that couldn't fail.
- Measured: a 1080p 5 s clip imports in 64–116 ms (220–265 ms for the first, which starts the
  worker) with no long animation frames, even at 4× CPU; editing a cut of 30 files holds 60 FPS;
  first-load JS 95.7 KB gzip of 120 KB, the worker 72.6 KB (`docs/PERF.md`).

## M2 · Timeline UI on placeholder clips (2026-10-18)

- The editor at 1440 × 900, built to the design canvas: app bar, media bin, program monitor,
  inspector, toolbar and the timeline with V2, V1 and A1. The empty project offers "Start a cut".
- "Load the robot story" loads the demo's shape with placeholders until M5: 15 shots of 3 s on V1 in
  shot order and 45 s of music on A1, in muted colors (00:00:45:00 at 24 fps).
- Every clip state from the boards: hover, selected, several selected, keyboard focus, dragging
  (lifted, with its old place dashed and the new start), snapping (a white line), trimming (the cut
  part faint, the new in or out point), at the source's end (hatched) and one frame long.
- Editing: move along a track or to the other of its kind (it stops at neighbors, needs a gap on
  another track), trim both edges (stops at the source, neighbors and one frame), `[` and `]`, S to
  split, Delete with an undo toast, click and Shift-click to select, Esc, undo and redo. A whole
  drag or trim is one undo step: the document is written once, on release.
- Snapping to the playhead, clip edges and 0 within 8 px; Alt drags freely; N turns it off.
- The ruler's labels never collide at any zoom; the playhead moves from requestAnimationFrame;
  Cmd/Ctrl + wheel and + and − zoom around the pointer, from fitting the cut to 48 px per frame;
  Shift+Z fits; the wheel scrolls; ←/→, Shift+←/→, Home and End move the playhead.
- The media bin lists the project's assets; Enter or a click adds one at the playhead, and a card
  can be dragged onto a track. The monitor shows the clip on top at the playhead. The inspector shows
  a clip's details or several, and edits the playhead's timecode.
- `?perf=1` loads the perf overlay as its own chunk: FPS, long animation frames, the slowest
  interaction and the JS heap.
- 118 new tests (308 unit and component tests in all), and 24 end-to-end runs: spec tests 1 to 7
  plus the bin, the scroll bar, Tab to a clip out of view and the overlay, in Chrome and now
  WebKit. A one-off axe scan of every state finds nothing.
- Measured: 60 FPS with no long animation frames while dragging, trimming and zooming, even with
  the CPU slowed 4×; editing interactions 16–40 ms; first-load JS 86.4 KB gzip of 120 KB
  (`docs/PERF.md`).

## M1 · Time model, document and commands (2026-10-18)

- The time model (`src/engine/time.ts`): frames, seconds and microseconds with one rounding rule
  (a time shows the frame at or before it), an asset's length in frames, `HH:MM:SS:FF` timecodes
  computed from integers only, and a timecode parser that accepts shorthand such as `19:06`.
- The document types from spec 4.3, and helpers: a new project with tracks V2, V1 and A1, finding
  a clip, the clip under a frame, and the cut's length.
- Six pure edit commands: add, move, trim start, trim end, split and delete. Each returns the new
  project or a clear error instead of throwing, and keeps every rule: clips sorted with no
  overlaps, whole frames, only frames the source has, at least one frame, the right kind of track.
- Snapping: the closest of the playhead, frame 0 and other clips' edges within 8 px; a dragged clip
  snaps by its closer edge.
- Two Zustand stores: the document, with undo and redo from zundo (100 steps, one per edit, each
  labeled for "Undo: trim end of 07-medium"), and the UI state (playhead, selection, zoom, scroll,
  snapping, active track), which never enters the history. The selection lets go of clips that an
  edit or an undo takes away.
- 165 new tests (190 in all): every rule and edge case from spec section 5, plus fast-check
  property tests in which about 8,600 random edits per run never break a rule or touch another
  clip, and undo always restores the exact project.
- No UI yet, so the app's JS is unchanged at 68.1 KB gzip. Tailwind now reads class names only
  from `src/` and `index.html`, which takes 0.7 KB of unused rules out of the CSS (`docs/PERF.md`).

## Design reference (2026-10-18)

- The design canvas (12 boards, every state) replaces the spec's Figma frame;
  `docs/design/README.md` maps it to the code.
- Editor tokens in `src/app/editor-tokens.css`: panel and track sizes, the clip radius, and color
  roles for the playhead, selection, snap line and waveform.
- Contrast tests for every text color and every mark the editor draws; a focus ring on
  everything focusable.

## M0 · Setup and a live skeleton (2026-10-18)

- Vite 8, React 19 and TypeScript 6 (strict, with checked index access) on Node 24 (`.nvmrc`)
  and pnpm.
- Tailwind CSS 4 with the Feed's design tokens and its font, Instrument Sans.
- ESLint with typescript-eslint's strict typed rules; Vitest with Testing Library; Playwright
  in Google Chrome. One smoke test each.
- CI on GitHub Actions: install → lint → typecheck → unit tests → build → e2e, then a deploy
  to Vercel (production from `main`, a preview for each pull request).
- Live at https://storyboard-timeline.vercel.app.
- Measured: first-load JS 68.1 KB gzip against the 120 KB budget (`docs/PERF.md`).
