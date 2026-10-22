# Performance log

Every optimization gets a before and after number here.

## Bundle budget (M0)

Measured on 2026-10-18 on the M0 skeleton (Vite 8.3.4, React 19.3.1): `pnpm build`, then each
file in `dist/assets/` gzipped with Node's default level (Vite's own build report says 68.8 KB
for the JS).

| | gzip | raw | files |
| --- | --- | --- | --- |
| First-load JS (the app shell) | 68.1 KB | 220.0 KB | 1 |
| **Budget (spec section 2)** | **120 KB** | | |
| CSS | 2.5 KB | 7.0 KB | 1 |
| Font (Instrument Sans, Latin; woff2 is already compressed) | 30.1 KB | 30.1 KB | 1 |

React and React DOM are nearly all of the 68.1 KB, which leaves about 52 KB for the editor
itself. The media engine doesn't count: it loads only when media is added (spec section 2).

## M1: the JS didn't change, and the CSS shrank

Measured on 2026-10-18 after M1, the same way as M0 (Vite 8.3.4, `pnpm build`, each file gzipped
with Node's default level), against a build of the last commit before M1.

| | Before M1 | After M1 | Change |
| --- | --- | --- | --- |
| First-load JS, gzip | 68.1 KB (68,059 B) | 68.1 KB (68,059 B) | None: the same file, byte for byte |
| CSS, gzip | 3.4 KB (3,387 B) | 2.7 KB (2,712 B) | 675 B smaller |
| CSS, raw | 11.2 KB | 7.6 KB | 3.6 KB smaller |

The app doesn't import the engine yet, so none of it ships. The CSS shrank because Tailwind now
reads class names only from `src/` and `index.html`. Before, it also read
the docs and the tests and turned their words into 32 rules the app doesn't use, from the code
samples in `docs/design/README.md` (`h-track-v1`, `bg-playhead`) to "relative" in a test comment.
M0's table shows 2.5 KB of CSS; the editor tokens and the focus ring, added after it, had brought
that to 3.4 KB.

Ahead for M2: everything `src/engine` exports, with zustand and zundo, is 3.9 KB gzip (zustand
0.38 KB and zundo 0.53 KB of it), measured with a Vite build that leaves React out. That leaves
about 48 KB of the 120 KB budget for the timeline UI.

## M2: the editor, measured

Measured on 2026-10-18 on an Apple M1 Pro (16 GB, macOS 26.6) in Google Chrome, headless, at
1440 × 900, on the production build (`pnpm build`, `pnpm preview`) with `?perf=1`.

### Bundle

The same method as M0 and M1: each file in `dist/assets/` gzipped with Node's default level,
against the M1 build.

| | M1 | M2 | Change |
| --- | --- | --- | --- |
| First-load JS, gzip | 68.1 KB (68,059 B) | 86.4 KB (86,360 B) | +18.3 KB: the editor, the engine, zustand and zundo |
| **Budget (spec section 2)** | **120 KB** | **120 KB** | 33.6 KB left |
| Perf overlay, its own chunk, only with `?perf=1` | | 1.3 KB (1,318 B) | |
| CSS, gzip | 2.7 KB (2,712 B) | 5.9 KB (5,941 B) | The editor's classes |
| CSS, raw | 7.6 KB | 24.9 KB | |

The engine's 3.9 KB estimate from M1 held: the rest is the editor's components.

### Editing

`pnpm bench:editing` (`bench/editing.ts`) loads the robot story, then:

1. drags 05-wide up to V2 and back and forth along it, snapping on the way: 250 pointer moves;
2. trims 08-closeup's start back and forth, into its neighbor and its source's start: 250 moves;
3. zooms in and out with Ctrl + wheel over the tracks: 250 wheel notches, up to 48 px per frame.

Playwright sends one pointer move per frame (60 a second), like a steady hand, and wheel notches
about 30 a second. A requestAnimationFrame loop in the page records every frame, and a
PerformanceObserver counts long animation frames (over 50 ms). Run twice: at full speed and with
Chrome's CPU slowed 4× (`pnpm bench:editing 4`), roughly a low-end laptop.

| | CPU | FPS | p95 frame | Longest frame | Long animation frames |
| --- | --- | --- | --- | --- | --- |
| Drag a clip | 1× | 60 | 16.7 ms | 16.8 ms | 0 |
| Trim a clip | 1× | 60 | 16.7 ms | 16.8 ms | 0 |
| Zoom with Ctrl + wheel | 1× | 60 | 16.8 ms | 16.8 ms | 0 |
| Drag a clip | 4× | 60 | 16.7 ms | 16.8 ms | 0 |
| Trim a clip | 4× | 60 | 16.7 ms | 16.8 ms | 0 |
| Zoom with Ctrl + wheel | 4× | 60 | 16.7 ms | 16.8 ms | 0 |

Headless Chrome paints at 60 Hz, so 60 FPS is the ceiling here. One early zoom run had a single
50.1 ms frame, which didn't come back in the later runs.

### Interactions

The Event Timing API's duration, from input to the next paint, per interaction (a press and its
release count as one; the perf overlay shows the slowest, as INP would), over six runs at full
speed and two at 4×:

| Interaction | 1× | 4× |
| --- | --- | --- |
| "Load the robot story" (renders the whole editor) | 72–104 ms, median 80 | 168 ms |
| Pressing a clip to drag it | 24–40 ms | 24 ms |
| Pressing a trim handle | 16–24 ms | 24 ms |
| Cmd/Ctrl+Z | 16–24 ms | 16–24 ms |

Every editing interaction stays well under the spec's 100 ms INP target, even at 4×. The slowest
is the one-time load of the story: about 30 ms of rendering every panel, the clips and the ruler
for the first time, then style and layout. It crosses 100 ms in some runs and at 4×. M5 replaces
this click with a fetch from the Feed, which shows a loading state at once; if the load is still
slow then, that's the first number to work on.

## M3: import and analysis, measured

Measured on 2026-10-18 on the same Apple M1 Pro (16 GB, macOS 26.6) in Google Chrome, headless, at
1440 × 900, on the production build (`pnpm build`, `pnpm preview`).

### Bundle

The same method as before: each file in `dist/assets/` gzipped with Node's default level, against
the M2 build.

| | M2 | M3 | Change |
| --- | --- | --- | --- |
| First-load JS, gzip | 86.4 KB (86,360 B) | 95.7 KB (95,719 B) | +9.4 KB: My files and its import queue, reading OPFS, the media cache, peak levels, filmstrip and waveform tiles, the previews |
| **Budget (spec section 2)** | **120 KB** | **120 KB** | 24.3 KB left |
| Import worker, its own chunk, loaded on the first import | | 72.6 KB (72,590 B), 279 KB raw | Nearly all Mediabunny, with five parsers |
| The same worker with Mediabunny's `ALL_FORMATS` (not shipped) | | 97.5 KB (97,468 B), 384 KB raw | The five parsers save 25 KB (measured before the review's fixes, which added 55 B) |
| Perf overlay, its own chunk | 1.3 KB (1,318 B) | 1.3 KB (1,346 B) | |
| CSS, gzip | 5.9 KB (5,941 B) | 6.2 KB (6,210 B) | The bin's rows and drop zone |

None of Mediabunny is in the shell: the main thread never imports it (spec section 2: the media
engine loads only when media is added).

### Import

`pnpm bench:import` (`bench/import.ts`) imports a file six times in one page, each a copy on disk
under a new name, and reads the app's performance marks: from picking the file to `import:analyzed`
(read, checked, first frame decoded), `import:copied` (in OPFS) and `import:ready` (a thumbnail per
second made and saved). The first import also starts the worker and loads Mediabunny. A
PerformanceObserver counts long animation frames (over 50 ms) on the main thread from the pick to
ready. The page settles first (fonts loaded, one second idle): an import started in the first
moments after load shares its frames with startup's. Two files, three runs each, medians:

- the 1080p 5 s fixture, `e2e/fixtures/05-wide.mp4` (95 KB: a flat test pattern);
- a camera-like 1080p 5 s clip at 20 Mbit/s (11.8 MB), made for the run and not committed:
  `ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=24:duration=5 -f lavfi -i
  sine=frequency=440:sample_rate=48000:duration=5 -c:v libx264 -profile:v high -pix_fmt yuv420p
  -preset fast -b:v 20M -maxrate 20M -bufsize 40M -g 48 -c:a aac -b:a 192k -movflags +faststart
  camera-1080p-5s.mp4`, then `pnpm bench:import 1 camera-1080p-5s.mp4`.

The 1× rows are from the merged build; the 4× rows from the build before the review's fixes, which
didn't change the import's path.

| File | CPU | Import | Read and checked | Copied | Thumbnails made | Ready | Long animation frames |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Fixture, 95 KB | 1× | First | 157 ms | +4 ms | +57 ms | 218 ms | 0 |
| Fixture, 95 KB | 1× | Later | 15 ms | +3 ms | +46 ms | 64 ms | 0 |
| Camera-like, 11.8 MB | 1× | First | 144 ms | +39 ms | +82 ms | 265 ms | 0 |
| Camera-like, 11.8 MB | 1× | Later | 16 ms | +32 ms | +68 ms | 116 ms | 0 |
| Fixture, 95 KB | 4× | First | 195 ms | +10 ms | +60 ms | 265 ms | 0 |
| Fixture, 95 KB | 4× | Later | 22 ms | +4 ms | +49 ms | 75 ms | 0 |
| Camera-like, 11.8 MB | 4× | First | 199 ms | +38 ms | +79 ms | 316 ms | 0 |
| Camera-like, 11.8 MB | 4× | Later | 30 ms | +35 ms | +75 ms | 140 ms | 0 |

The main thread keeps every frame under 50 ms through an import, even with its CPU slowed 4×
(Chrome's throttling applies to the page's thread). Copying runs at about 350 MB/s. The first
import's extra ~150 ms is the worker starting and Mediabunny loading. Two things the bench found on
the way, both fixed in the bench, not the app: a file handed to Playwright as bytes is rebuilt in the
page, on its main thread (a 700 ms frame for 12 MB), and an import in the first second after load
shares startup's long frame at 4×.

### Editing with filmstrips

`pnpm bench:editing 1 files` runs M2's drag, trim and zoom on a cut of imported files in place of
the placeholders: the 1080p fixture once per shot (15 clips of 5 s on V1, each with its filmstrip)
and the 3 s tone 15 times along A1 (each with its waveform). The trim takes 06-tracking, since 5 s
clips put 08-closeup out of view. Two runs each, the higher of their numbers:

| | CPU | FPS | p95 frame | Longest frame | Long animation frames |
| --- | --- | --- | --- | --- | --- |
| Drag a clip | 1× | 60 | 16.8 ms | 16.8 ms | 0 |
| Trim a clip | 1× | 60 | 16.8 ms | 16.8 ms | 0 |
| Zoom with Ctrl + wheel | 1× | 60 | 16.8 ms | 33.3 ms | 0 |
| Drag a clip | 4× | 60 | 16.7 ms | 16.8 ms | 0 |
| Trim a clip | 4× | 60 | 16.8 ms | 16.8 ms | 0 |
| Zoom with Ctrl + wheel | 4× | 60 | 16.7 ms | 33.3 ms | 0 |

Moving and trimming never redraw a tile (they're laid along the source), so they cost what they did
on placeholders. Zooming redraws every visible clip's tiles at each step, about 15 ms of main-thread
work per wheel notch with 30 clips in view (a trace: 8 to 10 ms of script, rendering and drawing,
then paint), so now and then a frame takes two vsyncs. Counted over 16 zoom sweeps of 250 notches
each (about 8,100 frames) on the same cut, by tile width:

| Tiles | Frames over 20 ms | Of |
| --- | --- | --- |
| 4,096 device px (before) | 10 | 8,106 |
| 1,024 device px (after, shipped) | 4 | 8,106 |
| 1,024 device px, never resized while zooming | 7 | 8,108 |
| Placeholders, no tiles | 0 | 8,107 |

Interactions while building and editing the cut stay at 16–56 ms (88 ms at 4×; adding a file at the
playhead, which draws its new tiles, is the slowest), under the 100 ms INP target; the overlay's INP
figure was 32–48 ms. The placeholder story's numbers are unchanged from M2: 60 FPS with no long
frames, and "Load the robot story" at 88 ms (176 ms at 4×).

## M4: preview and playback, measured

Measured on 2026-10-18 on the same Apple M1 Pro (16 GB, macOS 26.6) in Google Chrome at 1440 × 900,
on the production build (`pnpm build`, `pnpm preview`) with `?perf=1`.

### Bundle

The same method as before: each file in `dist/assets/` gzipped with Node's default level, against
a build of `main` with M3 merged.

| | M3 | M4 | Change |
| --- | --- | --- | --- |
| First-load JS, gzip | 95.7 KB (95,744 B) | 103.0 KB (103,039 B) | +7.3 KB: playback, the monitor's picture, the clock, the queues, the decode worker's client, the inspector's still, the transport and the counters |
| **Budget (spec section 2)** | **120 KB** | **120 KB** | 17.0 KB left |
| Decode worker, its own chunk, loaded on the first frame asked for a file | | 64.0 KB (64,001 B), 247 KB raw | Nearly all Mediabunny again: the two workers share no chunk |
| Import worker, its own chunk | 72.7 KB (72,686 B) | 72.7 KB (72,686 B) | The same file |
| Perf overlay, its own chunk | 1.3 KB (1,319 B) | 1.6 KB (1,620 B) | The media rows |
| CSS, gzip | 6.2 KB (6,212 B) | 6.6 KB (6,554 B) | The transport, the monitor's states, the error badge |

(The M3 row is a fresh build of `main`; M3's own table says 95,719 B for the shell. The M4 row is
the merged branch, after the review's fixes.)

### Playback and scrubbing

`pnpm bench:playback` (`bench/playback.ts`) makes its media with ffmpeg the first time, in the
system's temporary folder (72 MB, not committed): three 15 s clips of 1080p H.264 at 24 fps, like a
camera's (a moving test pattern at 12 Mbit/s, High profile with B-frames, a key frame every 2 s),
end to end on V1; a fourth on V2 over the middle one, from 15 s to 30 s; and 45 s of 192 kbit/s AAC
music on A1. It imports them and builds the cut through the UI, fits it in view (Shift+Z), then:

1. drags the ruler across the whole cut and back, one pointer move per display frame, and reads each
   move's coarse latency: from the input event to the picture drawn (the cached exact frame, or the
   nearest thumbnail);
2. rests the pointer at 30 places along the cut, 400 ms each, still pressed, and reads each rest's
   exact latency: from the input to the exact frame drawn;
3. steps with →, a press every 300 ms, 24 times, and reads each step's exact latency;
4. plays the whole cut 5 times from the start and reads, after each: the late or dropped frames of
   the 1,440 the two tracks show (1,080 on V1, 360 on V2), the clock it followed, the open
   VideoFrames once paused (polled until the worker has let go), and the JS heap after a forced
   garbage collection.

The latencies are the app's own performance measures (`scrub:coarse`, `scrub:exact`, made only with
`?perf=1`); playback's numbers come from its stop mark. "Drawn" is when the canvas is drawn, before
the browser paints it, which adds up to a display frame.

Three runs: headless at full speed, headless with Chrome's CPU slowed 4× (roughly a low-end
laptop; Chrome's throttling slows the page's main thread), and headed, the window in view, with the
GPU as a person's Chrome has it.

| Goal (spec section 2) | Target | Headless 1× | Headless 4× CPU | Headed 1× |
| --- | --- | --- | --- | --- |
| A picture while dragging the ruler, p95 (p50) | ≤ 50 ms | 14 ms (12) | 11 ms (8) | 9 ms (4) |
| The exact frame after the pointer rests, p95 (p50) | ≤ 200 ms | 143 ms (52) | 137 ms (53) | 110 ms (57) |
| Late or dropped frames, each of 5 play-throughs | ≤ 1 % | 0 of 1,440 | 0 of 1,440 | 0 of 1,440 |
| Open VideoFrames once paused, after each play-through | 0 | 0 | 0 | 0 |
| JS heap after each play-through, after a collection | no growth | 5.0–5.1 MB | 5.0–5.1 MB | 4.9–5.1 MB |
| Long animation frames (over 50 ms), scrubbing and playing | | 0 | 0 | 0 |
| A step with →, p95 (p50), not a goal | | 89 ms (66) | 68 ms (56) | 73 ms (60) |

The headless 1× column is the merged branch; the 4× and headed columns ran on the build just before
the review's fixes, which don't touch the scrub's or playback's paths. Two 1× runs of the same
build differ by about 15 ms at the exact frame's p95 (130 and 143 ms) and by a frame or two
elsewhere.

Every play-through followed the audio clock and ran to 00:00:45:00. The exact frame's time is mostly
the decoder's: a frame is decoded from the key frame before it, so the farther a rest is past one
(up to 47 frames at this media's 2 s spacing), the longer it takes, and the bench's 30 rests fall
all over that spacing. A picture while dragging is the cached frame or the thumbnail, drawn in the
display frame the input arrives for. The heap moves within 0.2 MB, with no steady climb; decoded
frames and bitmaps live outside it, and the open-frame count shows they're let go.

Two things the bench found on the way, both in the measuring:

- A scrub's exact frame, arriving, was also counted as a coarse latency. Before the fix, the rests'
  coarse p95 read 67 ms (it was the exact frame's time); after, 14 ms.
- The latencies first ran from when the playhead was set, but Chrome hands a pointer move to the page
  at the start of a display frame, so the wait before it was left out: the picture while dragging
  read 0 ms at p50 (29 ms p95). They now run from the input event's own time, which adds that
  wait (13 ms at p50).

A headed window that another window covers is hidden as far as the page knows, and a hidden page
pauses playback: an early headed run stopped twice that way, at 248 and 158
frames. The bench now counts the times the page was hidden and says where each play-through
stopped.

## M5: the Feed and the demo, measured

Measured on 2026-10-18 on the same Apple M1 Pro (16 GB, macOS 26.6) in Google Chrome at 1440 × 900,
on the production build (`pnpm build`, `pnpm preview`) with `?perf=1`.

### Bundle

The same method as before: each file in `dist/assets/` gzipped with Node's default level, against
the M4 build.

| | M4 | M5 | Change |
| --- | --- | --- | --- |
| First-load JS, gzip | 103.0 KB (103,039 B) | 107.0 KB (107,000 B) | +4.0 KB: the bin's tabs and the Feed's cards, the tab's pages, the URL helpers, loading the story, remote media, the problem toast, the load-failure message |
| **Budget (spec section 2)** | **120 KB** | **120 KB** | 13.0 KB left |
| Feed client, its own chunk, loaded with the Feed tab or the story | | 24.9 KB (24,918 B), 87 KB raw | Nearly all zod; none of it in the shell |
| Decode worker, its own chunk | 64.0 KB (64,001 B) | 67.7 KB (67,673 B) | +3.7 KB: Mediabunny's `UrlSource`, the fetch for it |
| Import worker, its own chunk | 72.7 KB (72,686 B) | 76.5 KB (76,473 B) | +3.8 KB: `UrlSource`, the probe and the remote thumbnails |
| Perf overlay, its own chunk | 1.6 KB (1,620 B) | 1.6 KB (1,619 B) | The same code |
| CSS, gzip | 6.6 KB (6,554 B) | 6.6 KB (6,630 B) | The tabs and the cards |
| Demo music (`public/demo/music.mp3`), fetched with the story | | 720 KB (736,463 B) | An MP3; gzip doesn't shrink it |

### The robot story from the Feed

`pnpm bench:playback story` (`bench/playback.ts`) loads the robot story as a person would, times
it from the press to its clips on the timeline, waits 20 s for the filmstrips, fits the cut, and
measures as M4 does: the ruler dragged across the cut and back, 30 rests of 400 ms, 24 steps with
→, and 5 play-throughs, here of one track (1,080 frames each).

Until the Feed's CORS PR and the bucket's policy were live, the browser couldn't read the Feed, so
these runs, on 18 October, went through a local proxy that added those headers in front of the live
Feed and its bucket (not committed): the build's `VITE_FEED_ORIGIN` and `VITE_MEDIA_ORIGIN` pointed
at it. It added a hop through Node, and the browser spoke HTTP/1.1 to it, six requests at a time.
The same bench on the live Feed, once both were live, is in the next section.

The brief's decision: if the exact frame's p95 misses 200 ms on the 1080p originals, preview from
the Feed's 720p files. So both ran: the shipped build, which previews from the 720p file, and a
build that previews from the original (one line changed for the run, not shipped). A one-off run
with 3-second rests, so every rest's exact frame comes in however slow, gives the original's real
spread (the bench's 400 ms rests are shorter than most of its frames take).

| Goal (spec section 2) | Target | 720p file (shipped) | 1080p original |
| --- | --- | --- | --- |
| A picture while dragging the ruler, p95 (p50) | ≤ 50 ms | 14 ms (12) | 15 ms (13) |
| The exact frame after the pointer rests, 400 ms rests, p95 (p50) | ≤ 200 ms | 79 ms (49), every rest | 182 ms (35), but only 7 of 30 rests got it in 400 ms |
| The same, 3 s rests, p95 (p50), max | ≤ 200 ms | 115 ms (78), 132 | 2,515 ms (1,134), 2,931 |
| Late or dropped frames, each of 5 play-throughs | ≤ 1 % | 0 of 1,080 | 32 (3.0 %), then 0, 0, 0, 0 |
| Open VideoFrames once paused | 0 | 0 | 0 |
| JS heap after each play-through, after a collection | no growth | 5.8 MB | 5.7–5.8 MB |
| Long animation frames (over 50 ms) | | 0 | 0 |
| A step with →, p95 (p50), not a goal | | 57 ms (43) | 180 ms (84), 3 of 24 steps in 300 ms |
| Loading the story, press to clips on the timeline | | 2.0 s | 2.1 s |

The originals are 25 Mbit/s with one key frame per 5-second clip, so the frame at 2.5 s needs
every byte and every frame before it: over the network, that's seconds. The first play-through
waited on the network too; by the second, Chrome's HTTP cache had the files. The 720p files are
2.5 Mbit/s, and their thumbnails already fetched them. So the preview reads the 720p file, and
export (M6) will read the original.

Loading the story took 2.0 s in the bench: the Feed's answer 0.4 s, the import worker's start
0.3 s, the 15 clips' facts 0.8 s (six at a time through the proxy; r2.dev speaks HTTP/2, so without
it they go at once), rendering 0.3 s. Decoding the music while the Feed answers took it to 1.5–1.7 s
in three later runs, and the filmstrips, which the app marks one by one ("feed:thumbnails"), were all
in after 11–15 s: each clip's 720p file read in full, one clip at a time, the first ones on screen
within a second. After a reload, the facts and the thumbnails come back from OPFS: the story loads
in 0.85–1.0 s with no request for its clips, and all 15 filmstrips are in 0.9–1.0 s after the
press. Making three filmstrips at a time instead of one (a build for the run, not shipped) took the
first visit's to 7.8–12.4 s in three runs; one at a time stays, since the clips on screen are first
in either way, and three jobs would share the network and the decoder with the monitor's first
frames. The live Feed's numbers for both are in the next section.

### The robot story on the live Feed

Measured again on 19 October, once the Feed's CORS PR was merged and the bucket's policy set: the
shipped build with its default origins, so the browser reads the Feed's API and r2.dev itself,
over HTTP/2. `pnpm bench:playback story`, headless at 1×:

| Goal (spec section 2) | Target | Through the proxy | Live Feed |
| --- | --- | --- | --- |
| A picture while dragging the ruler, p95 (p50) | ≤ 50 ms | 14 ms (12) | 14 ms (12) |
| The exact frame after the pointer rests, p95 (p50) | ≤ 200 ms | 79 ms (49) | 84 ms (49), at most 92 |
| Late or dropped frames, each of 5 play-throughs | ≤ 1 % | 0 of 1,080 | 0 of 1,080 |
| Open VideoFrames once paused | 0 | 0 | 0 |
| JS heap after each play-through, after a collection | no growth | 5.8 MB | 5.7–5.8 MB |
| Long animation frames (over 50 ms) | | 0 | 0 |
| A step with →, p95 (p50), not a goal | | 57 ms (43) | 55 ms (43) |
| Loading the story, press to clips on the timeline | | 2.0 s | 1.8 s |
| All 15 filmstrips in, first visit | | 11–15 s | 12.5 s |

Every goal holds on the real network. The story's load was 1.7 s on the production build and
2.3 s on the dev server, in a one-off check with no console errors: 15 clips on V1, the music on
A1 for 00:00:45:00, a picture on the monitor, and the playhead moving when it plays.

The filmstrips, one clip at a time (shipped) against three at a time (a build for the run, not
shipped), each in a fresh Chrome, the two builds taking turns over three rounds so the network's
ups and downs fall on both:

| Round | One at a time: load, filmstrips | Three at a time: load, filmstrips | After a reload, either |
| --- | --- | --- | --- |
| 1 | 1.7 s, 16.2 s | 1.6 s, 10.2 s | 0.3 s, 0.4 s |
| 2 | 1.7 s, 13.1 s | 2.2 s, 8.3 s | 0.2–0.3 s, 0.3–0.4 s |
| 3 | 1.6 s, 10.9 s | 1.6 s, 7.4 s | 0.2 s, 0.3 s |

Three at a time is a third faster on a first visit, every round. One at a time stays in M5: the
clips on screen get their filmstrips first either way, the story can be edited as soon as it's
in, and three decoders at once is more of the concurrency that CI's Linux WebKit hangs on.
M8, which fixes the worst number, can take it up. A reload is faster than
through the proxy (0.85–1.0 s then): the browser keeps the Feed's answer, and OPFS the rest.

### Editing the robot story

`pnpm bench:editing` (M2's drag, trim and zoom) now edits the story from the Feed, with its
filmstrips, once all 15 are in, where M2 and M3 edited flat placeholders. Through the proxy on
18 October, and on the live Feed on the 19th:

| | CPU | FPS | p95 frame | Longest frame | Long animation frames |
| --- | --- | --- | --- | --- | --- |
| Drag a clip | 1× | 60, 60 | 16.8 ms, 16.8 ms | 16.8 ms, 16.8 ms | 0, 0 |
| Trim a clip | 1× | 60, 60 | 16.8 ms, 16.8 ms | 16.8 ms, 16.8 ms | 0, 0 |
| Zoom with Ctrl + wheel | 1× | 60, 60 | 16.7 ms, 16.8 ms | 16.8 ms, 16.8 ms | 0, 0 |

Interactions took 16–32 ms, and 80 ms (64 ms on the live Feed) for the press on "Load the robot
story", which now only shows its loading state and starts the requests: the editor renders the
story when it arrives, outside any interaction (M2 measured 72–104 ms for that press, which
rendered everything at once).

### The cut of files, on the M5 build

M4's bench (`pnpm bench:playback`), unchanged: three 15 s 1080p clips on V1, one on V2, 45 s of
music, from My files. M5 changes how assets are read, so it runs again, headless at 1×:

| Goal (spec section 2) | Target | M4 | M5 |
| --- | --- | --- | --- |
| A picture while dragging the ruler, p95 (p50) | ≤ 50 ms | 14 ms (12) | 15 ms (12) |
| The exact frame after the pointer rests, p95 (p50) | ≤ 200 ms | 143 ms (52) | 107 ms (56) |
| Late or dropped frames, each of 5 play-throughs | ≤ 1 % | 0 of 1,440 | 0 of 1,440 |
| Open VideoFrames once paused | 0 | 0 | 0 |
| JS heap after each play-through | no growth | 5.0–5.1 MB | 5.0–5.1 MB |
| Long animation frames | | 0 | 0 |
| A step with →, p95 (p50) | | 89 ms (66) | 77 ms (63) |

A first run, with the editor still open in another window, had 4 late frames and one 80 ms frame in
one play-through; alone, none (the M4 notes: run the benches alone).

## M6: export, measured

Measured on 2026-10-19 on the same Apple M1 Pro (16 GB, macOS 26.6) in Google Chrome, headless, at
1440 × 900, on the production build (`pnpm build`, `pnpm preview`) with `?perf=1`.

### Bundle

The same method as before: each file in `dist/assets/` gzipped with Node's default level, against
a build of `main` with M5 merged, made on the same machine at the start of M6.

| | M5 | M6 | Change |
| --- | --- | --- | --- |
| First-load JS, gzip | 107.0 KB (106,980 B) | 107.8 KB (107,821 B) | +0.8 KB: the toolbar's Export and Export unavailable, the dialog's open flag and lazy mount, the toasts' action and one-line problem, the keyboard held back behind a dialog |
| **Budget (spec section 2)** | **120 KB** | **120 KB** | 12.2 KB left |
| Export dialog, its own chunk, loaded when Export opens | | 6.8 KB (6,779 B), 19 KB raw | The dialog's steps, the session, the words, the mix's scheduling, the worker's client |
| Export worker, its own chunk, started by the dialog's first question | | 111.7 KB (111,721 B), 447 KB raw | Mediabunny again, with its MP4 and WebM writers and its encoders |
| Decode worker, its own chunk | 67.7 KB (67,726 B) | 67.7 KB (67,719 B) | The media sources moved to a shared module |
| Import worker, its own chunk | 76.6 KB (76,603 B) | 76.6 KB (76,603 B) | The same file |
| Perf overlay, its own chunk | 1.6 KB (1,615 B) | 1.6 KB (1,641 B) | The export check's row |
| CSS, gzip | 6.6 KB (6,646 B) | 6.8 KB (6,802 B) | The dialog |

### Export speed

`pnpm bench:export` (`bench/export.ts`) loads the robot story as a person would, in a fresh browser
context for each run (so Chrome's cache doesn't hold the clips from the run before), waits for its
15 filmstrips, then exports and reads the app's own `export` measure: from the press on Export to
the done screen, so it holds the music's mix, the frame loop, finishing the file and the output
check. The frame loop also says how long it waited for frames (reading and decoding) and for the
encoder's `add()`. Three runs a size. "Network" reads the live Feed and r2.dev, as a person's
Chrome does; "local" serves the Feed's answer and the same files from this machine
(`pnpm bench:export local`, on a build pointed at it), which takes the network out.

| 45 s robot story, goal (spec section 2): 1080p at ≥ 1× real time | Network | Media local |
| --- | --- | --- |
| <a id="export-1080p"></a>1080p, press to done (median) | 21.2–23.7 s (22.1): 2.0× real time | 5.8–6.0 s (6.0): 7.5× |
| 720p, press to done (median) | 3.4–3.5 s (3.4): 13× | 3.2–3.3 s (3.2): 14× |
| The file | 37.3 MB at 1080p, 17.7 MB at 720p ("About 37 MB" and "About 18 MB") | the same |
| The output check | passed, every run | passed, every run |
| Open VideoFrames after each export | 0 | 0 |
| Long animation frames (over 50 ms) during each export | 0 | 0 |

Every goal holds: the story exports at 1080p twice as fast as it plays, from the live Feed. At 720p
the Feed's 720p files are already in Chrome's cache when the export starts (the filmstrips read
them as the story loads), so the network and local columns agree.

### Where the time goes

The frame loop's waits, per export (medians; the music's mix, finishing the file and the check take
about 0.1, 0.1 and 0.05 s in every case):

| | Waiting for frames (reading, decoding) | Waiting for the encoder (`add()`) |
| --- | --- | --- |
| 1080p, network | 19.2 s | 2.6 s |
| 1080p, local | 0.14 s | 5.5 s |
| 720p, network (cached) | 0.29 s | 2.9 s |
| 720p, local | 0.08 s | 2.9 s |

At 1080p over the network the export waits on r2.dev: it downloads the originals' bytes the cut
decodes, at the network's speed. On this machine that's about 6.5 MB/s (curl: 4.9 MB/s on one
stream from r2.dev, 5.4 MB/s on three at once, so more requests at a time wouldn't help). With the
media local, the hardware encoder is the limit: 1,080 frames of 1080p H.264 in 5.5 s, about 200 a
second, and about 375 a second at 720p. Decoding the originals forward, one pass per clip, costs
almost nothing next to either. While the network is slow, the encoder's time hides behind it (the
1080p network run waits for it only 2.6 s).

### What an export downloads

Counted at the network interface (`netstat -ib` on en0, before and after an export; other traffic
on the machine counts too), a 1080p export of the story receives 145 to 147 MB: the 124 MB the cut
decodes (the first 3 s of each original, from the files' byte positions with ffprobe), the few
frames the decoder reads past each out point, and TLS. The originals are 243 MB whole. Over a
network that limits the export, Mediabunny's UrlSource (which reads up to 8 MiB ahead of what it's
asked for) never gets far ahead of the decoder; with the media local, which is faster than the
export, it reads most of each file, 219 to 224 MB, at no cost in time.

A first count in the browser said 242 to 252 MB, but Playwright's `request.sizes()` reports an
aborted request's Content-Length, not the bytes that came (one file "got" 10.29 + 6.09 MB, more
than its 10.3 MB). Two ways to read less were built on that wrong count and measured against the
shipped reader, the builds taking turns, each run in a fresh context (not shipped):

| Build | Runs | Press to done | Bytes |
| --- | --- | --- | --- |
| Mediabunny's UrlSource (shipped) | 6 | 22.2–25.1 s | 145–147 MB at the interface (2 of the runs) |
| UrlSource given a window per file: the clips' latest out point plus 10 %, from a 64 KB probe | 3 | 21.4–25.9 s | 147 MB at the interface (2 of the runs) |
| Our own reader: 1 MiB range requests, at most 8 ahead | 3 | 31.8–41.4 s | 176–187 MB (its requests complete, so Playwright's count holds) |

The window changed nothing over the network; our reader was slower, as each of its 190 requests
waited about 0.2 s for r2.dev's first byte.

### Memory

The JS heap, after a garbage collection with the dialog closed, over twelve 720p exports in one
page: 5.05 MB before, 5.47 MB after the first (the dialog's chunk, loaded once), then about 25 KB
more per export, slowing (5.75 MB after the twelfth). Toggling Snapping twelve times in the same
way climbs 17 KB a time, and opening and closing the dialog twelve times without exporting 21 KB a
time: the page's own warm-up under the bench's clicks, not the export. The file, the pictures and
the decoded frames live outside the JS heap; the export worker lets go of all of them (0 open
VideoFrames after every export), and closing the dialog drops the file.

## M7: saving, states and the phone view, measured

Measured on 2026-10-19 on the same Apple M1 Pro (16 GB, macOS 26.6) in Google Chrome, headless, at
1440 × 900, on the production build (`pnpm build`, `pnpm preview`) with `?perf=1`.

### Bundle

The same method as before: each file in `dist/assets/` gzipped with Node 24's default level,
against M6's numbers.

| | M6 | M7 | Change |
| --- | --- | --- | --- |
| First-load JS, gzip | 107.8 KB (107,821 B) | 115.7 KB (115,690 B) | +7.9 KB: restoring, autosave's timing and status, the project's lock, the live region and its words, the sliders and nudges, the app bar's buttons, the offline state, the chunks' retries, missing files, the switch to the phone view |
| **Budget (spec section 2)** | **120 KB** | **120 KB** | 4.3 KB left |
| Save worker, its own chunk, started by restoring or a second after the editor shows | | 28.1 KB (28,106 B), 102 KB raw | Writes, reads back and clears the saves; zod and the save's schema |
| The app bar's dialogs, one chunk, loaded when either opens | | 2.3 KB (2,347 B) | Keyboard shortcuts and the New project confirmation |
| Phone view, its own chunk, loaded only under 768 px | | 2.6 KB (2,592 B) | |
| Export dialog, its own chunk | 6.8 KB (6,779 B) | 6.8 KB (6,763 B) | Loaded through the retrying loader |
| Feed client, its own chunk | 25.0 KB (24,982 B) | 25.0 KB (24,981 B) | The same |
| Import worker, its own chunk | 76.6 KB (76,603 B) | 76.6 KB (76,611 B) | A video's thumbnails' count in thumbnails.json, not a second meta.json |
| Decode and export workers | 67.7 and 111.7 KB | 67.7 and 111.7 KB | The same files |
| Perf overlay, its own chunk | 1.6 KB (1,641 B) | 1.6 KB (1,644 B) | |
| CSS, gzip | 6.8 KB (6,802 B) | 7.3 KB (7,261 B) | The app bar, the dialogs, the phone view, the offline note, the handles' focus |

With the phone view and the dialogs lazy, Rolldown first moved what they share with the shell
(React, the stores, playback) out of the entry into two more files loaded at the start: 116,590 B in
three files (95,014 + 20,583 + 993), against 114,625 B in one for the same code, so 1.9 KB of
imports and exports between them. A `codeSplitting` group keeps every module loaded at the start in
the entry (`vite.config.ts`); every lazy chunk imports from it alone.

### Editing with saving on

`pnpm bench:editing` (M2's drag, trim and zoom on the robot story) now also reads the app's `save`
measures: each save's work on the main thread, serializing the document and the view. The story
saves once as it loads; the drag and the trim, each undone at once, leave the document as saved, so
they write nothing; and the zoom saves the view once, a second after it stops (the view waits until
it settles, so playback and a long zoom don't save every frame).

| | CPU | FPS | p95 frame | Longest frame | Long animation frames |
| --- | --- | --- | --- | --- | --- |
| Drag a clip | 1× | 60 | 16.8 ms | 16.8 ms | 0 |
| Trim a clip | 1× | 60 | 16.7 ms | 16.8 ms | 0 |
| Zoom with Ctrl + wheel | 1× | 60 | 16.8 ms | 33.3 ms | 0 |
| Drag a clip | 4× | 60 | 16.8 ms | 16.8 ms | 0 |
| Trim a clip | 4× | 60 | 16.7 ms | 16.8 ms | 0 |
| Zoom with Ctrl + wheel | 4× | 60 | 16.8 ms | 33.4 ms | 0 |

| Saves during the runs | 1× | 4× |
| --- | --- | --- |
| Saves | 2 (1 of the document, 1 of the view) | 2 |
| Main-thread work per save | 0.1–0.7 ms | 0.1–0.3 ms |
| Size of a save | 7.9 KB of JSON (7,931–7,948 B) | the same |

Autosave never caused a long animation frame: the writing is the worker's, and the main thread
only turns 8 KB of document into JSON. The zoom's two-vsync frames are M3's tile redraws, as
before. Interactions stayed at 16–56 ms (the overlay's INP figure 24–32 ms).

### Restoring at startup

From the navigation to the page showing (a `MutationObserver` in the page, five loads each, warm
cache): the empty project with nothing saved shows at 19–57 ms; the robot story restored from a
save shows its clips at 53–68 ms, which includes starting the save worker, reading both slots back
and checking them against the schema. The first visit, with a cold cache, showed the empty state at
166 ms.

## M8: one command, the worst number, and the browser matrix

Measured on 2026-10-19 on the same Apple M1 Pro (16 GB, macOS 26.6.2) in Google Chrome 155,
headless, at 1440 × 900, on the production build with `?perf=1`, except where a row says otherwise.

### `pnpm bench`

One command now runs every bench (`bench/run.ts`): it builds the app once, serves `dist/` on port
4173 (or 5173 if that's taken: the Feed's bucket lets only those two local addresses read its
clips), checks that the page served there is this build, then runs the editing, import, playback
(the 1080p files, then the robot story) and export benches one after another, each alone in its
own browser, and adds a dated table at the end of this file, under "`pnpm bench` runs", with the
machine, the browser's version, the commit and the first-load JS. Each bench keeps its own command.
`pnpm bench webkit` and `pnpm bench firefox` run the same benches in Playwright's engines (the
browser matrix, below). A run takes about 15 minutes. The runs below say "with uncommitted
changes": those were this milestone's benches and docs, being written; the app's code in each was
the commit named.

### Choosing the worst number

The first run, on the build of `main` with M7 merged, is the baseline (17:06 below). Against spec
section 2's goals it held everywhere but two readings:

- **The exact frame on the 1080p files, 215 ms at p95** (goal 200 ms). The same build read 234 ms
  and then 102 ms (p50 74 and 45) in two more runs within fifteen minutes; M5 read 107 ms on the same
  bench, and nothing on the exact frame's path has changed since (M6 only moved where a source is
  opened). This machine was busy with other apps then (load averages of 7 to 14), and a frame's
  decode is what waits. Noise, not a regression: the after-fix run below reads 118 ms.
- **The 1080p export from the Feed, 0.9× real time** (goal 1×; 0.83× to 1.21× over three runs). It
  spent 44.8 of its 48.6 s waiting for frames, that is for r2.dev: curl fetched one original at
  1.7 MB/s that afternoon and three at once at 3.2 MB/s together, against 4.9 and 5.4 MB/s when M6
  measured 2.0×. The network, not the app: the fix is the media's own domain in place of the
  rate-limited `r2.dev` address.

The worst user-facing number was another: **the first visit's filmstrips, 16.3 s** after the
press on "Load the robot story" before every clip had the thumbnails the cut shows (each clip's
first 3 s). Until then a scrub over a clip without its thumbnails has no picture to show at once:
the scrub's first stage is the nearest thumbnail, so spec section 2's 50 ms goal while dragging
can't hold there. Every first-time visitor meets it. That's the one to fix.

### Fix: the filmstrips, from the Feed's previews first

Each clip's thumbnails were made from its 720p file, read whole (1.6 MB: it has one key frame, so
every thumbnail after the first needs the bytes before it), one clip at a time; the 15th clip's
first thumbnail came only after the other fourteen were done. The Feed also keeps a preview of
each clip, `previewKey`: its first 2.5 s at 480p, about 170 KB, cut from the clip's start by the
Feed's ingest script, the same frames (the preview's and the 720p file's frames at 0, 1 and 2 s
match at 41 to 43 dB PSNR, checked on 07-medium). The thumbnails for seconds 0, 1 and 2 can come
from it, and they're the ones the story's cut shows.

So a clip's thumbnails now come in two jobs: what its preview holds, then the rest from its 720p
file, which also stores them all for later sessions. Every clip's preview job runs before any
clip's 720p job. The robot story's 15 previews are 2.58 MB together, against 23.04 MB of 720p
files.

The two builds took turns, each run in a fresh browser context, so the network's ups and downs fell
on both. First, previews one at a time against the build before:

| Round | Before: the cut's filmstrips · all 15 clips' thumbnails | Previews first, one at a time |
| --- | --- | --- |
| 1 | 14.0 s · 13.9 s | 8.8 s · 22.7 s |
| 2 | 17.6 s · 17.7 s | 5.9 s · 22.0 s |
| 3 | 16.8 s · 16.8 s | 5.8 s · 23.7 s |

A preview's job is mostly a wait for the bucket's first byte (r2.dev answered in about 0.2 s), so
three at a time overlap those waits; the 720p files stay one at a time, after every preview:

| Round | Previews one at a time | Previews three at a time (shipped) |
| --- | --- | --- |
| 1 | 6.0 s · 24.0 s | 3.4 s · 18.4 s |
| 2 | 7.4 s · 29.2 s | 2.9 s · 23.5 s |
| 3 | 7.1 s · 31.2 s | 4.9 s · 22.4 s |

**The cut's filmstrips on a first visit: 14.0–17.6 s before, 2.9–4.9 s after.** All of the clips'
thumbnails, which only a clip trimmed past its first 3 s or added whole would show, take longer:
18–24 s against 14–18 s, as the 720p files now wait for every preview. After a reload both come
back from storage, as before.

After the independent review, the 720p job makes the preview's thumbnails again, from frames it
decodes on the way anyway, and stores all of them itself, so meta.json counts only writes that
succeeded (M8). The rounds above are from before that. Measured again over
the network, the fixed build against the one before it, three rounds taking turns:

| Round | Before the fix: the cut's filmstrips · all 15 clips' thumbnails | After the fix |
| --- | --- | --- |
| 1 | 3.8 s · 19.6 s | 3.0 s · 15.6 s |
| 2 | 4.2 s · 21.2 s | 3.6 s · 15.5 s |
| 3 | 3.9 s · 23.5 s | 3.7 s · 16.3 s |

So every clip's thumbnails come sooner with the fix, not later, close to the 14–18 s of the build
before M8; why isn't pinned down. With the end-to-end fixtures served locally, where a preview
holds all five of a clip's thumbnails and the 720p job makes all five again, the fix's own cost
shows without the network: every clip's thumbnails in 1.16 to 1.46 s against 1.01 to 1.25 s, four
rounds taking turns.

### Fix: first-load JS

The filmstrips' two rounds added 242 B to the shell. Then two things left it: a polyfill no
supported browser needs, and the Feed tab's list, which the first screen doesn't show:

| | First-load JS, gzip | Change |
| --- | --- | --- |
| M7 (the baseline build) | 115,690 B | |
| The filmstrips' two rounds | 115,932 B | +242 B |
| No modulepreload polyfill: every supported browser (Chrome, Safari 26, Firefox 130) preloads modules itself | 115,689 B | −243 B |
| The Feed tab's clips in a chunk of their own (2,602 B), fetched when the pointer or the focus reaches the tab | 114,384 B | −1,305 B |
| `?demo=story`, the link the Feed's "Open in Timeline" opens (M8) | 114,503 B | +119 B |
| <a id="first-load-js"></a>The picker's list checked in the tab's store, so the two lazy chunks that use the collections share no third chunk (below) | 114,487 B | −16 B |

**First-load JS: 115.7 KB before, 114.5 KB after, of the 120 KB budget** (5.5 KB left). The tab's
press asks for the Feed's first page at once, as before, so its list doesn't wait on the chunk; a
chunk that won't load says so in the panel, with Retry. The rest of the shell is the first screen
itself (React and React DOM are about half of it). Moving the "can't open this file" messages into
the import worker would have saved about 0.3 KB (the audio half must stay on the main thread, where
`decodeAudioData` runs), and the icons only lazy chunks use about as much, scattering the design's
icon set: both left as they are.

Moving the Feed tab's list out of the shell first left `src/feed/collections.ts` used only by two
lazy chunks, the list and the Feed client, so Rolldown gave it a 180 B chunk of its own. That
breaks M7's rule that every lazy chunk imports from the shell alone: Vite preloads a chunk's
imports beside it, so going offline at the first press would leave that small chunk failed in the
browser, and a retry under a new address would still import it. The store now checks the picker's
choice against the collections the tab offers, so the module is the shell's again (16 B less in
all), and `e2e/chunks.spec.ts` fails the build if a lazy chunk ever imports anything but the shell.

### After the fixes

`pnpm bench` again (17:53 below), against the baseline (17:06):

| Measure | Goal (spec section 2) | Before | After |
| --- | --- | --- | --- |
| First-load JS, gzip (before `?demo=story`) | ≤ 120 KB | 115.7 KB | 114.4 KB |
| Robot story: press to its clips on the timeline | | 3.3 s | 2.0 s |
| <a id="filmstrips"></a>Robot story, first visit: the cut's filmstrips in | | 16.3 s | 4.0 s |
| Robot story, first visit: all 15 clips' thumbnails in | | 16.4 s | 18.0 s |
| <a id="scrub-picture"></a>A picture while dragging the ruler, p95 (p50): the story · the 1080p files | ≤ 50 ms | 13 ms (10) · 14 ms (12) | 15 ms (13) · 15 ms (12) |
| <a id="exact-frame"></a>The exact frame after the pointer rests, p95 (p50): the story · the 1080p files | ≤ 200 ms | 99 ms (52) · 215 ms (70) | 74 ms (41) · 118 ms (46) |
| <a id="dropped-frames"></a>Late or dropped frames, worst of 5 play-throughs: the story · the files | ≤ 1 % | 0 of 1,080 · 0 of 1,440 | 0 · 0 |
| Open VideoFrames once paused | 0 | 0 · 0 | 0 · 0 |
| JS heap after each play-through: the story · the files | no growth | 6.0–6.1 MB · 5.2–5.3 MB | 6.1 MB · 5.2–5.3 MB |
| Drag, trim, zoom: FPS, long animation frames | 60 FPS | 60, 0 | 60, 0 |
| Slowest interaction while editing | ≤ 100 ms | 56 ms | 56 ms |
| Importing a 1080p clip: the first, then the median | | 222 ms, 71 ms | 220 ms, 69 ms |
| <a id="export-today"></a>Export at 1080p from the Feed, median of 3 | ≥ 1× real time | 48.6 s, 0.9× | 74.8 s, 0.6× |
| Export at 720p from the Feed, median of 3 | | 3.6 s, 12.6× | 5.6 s, 8.1× |

Everything on the editor's side held or got better; the scrub over the 1080p files was back under
its goal, as in M5. One long animation frame came during the story's five play-throughs (none in
the baseline's), with no frame late.

The exports got slower, and not from the app. With the Feed's files served from this machine
(`pnpm bench:export local 720p`, the two builds taking turns, two rounds of two), a 720p export took
3.2–3.3 s in both, 13.5–14.1× real time, reading 25–28 MB from the server in both. Over the
network, the 1080p export's wait for frames grew from 34–51 s to 52–74 s between the two runs:
r2.dev slowed through the afternoon, a rate-limited address the day's benches had read about 2 GB
from by then.

One change is the fix's. Right after a first visit, a 720p export finds less of the 720p files in
Chrome's cache than before. Counted at the network interface (`netstat -ib` on en0) over one 720p
export after the story's filmstrips were all in, the builds taking turns:

| | Before | After |
| --- | --- | --- |
| A fresh context (Playwright's, its cache in memory) | 1.1 MB, 1.2 MB received; 4.0 s, 3.6 s | 5.8 MB, 8.4 MB; 4.8 s, 5.9 s |
| A persistent profile (a disk cache, as a person's Chrome has) | 1.2 MB; 3.5 s | 6.5 MB, 7.4 MB; 4.5 s, 4.6 s |

So it isn't the cache's size. The 720p jobs still read each whole file, now after the previews
rather than first; why less of it is served from the cache at the export isn't pinned down. The
cost is a second or two on a 720p export in the first minute of a first visit, against twelve
seconds sooner for every filmstrip the cut shows.

The independent review's fix took that cost away. Its 720p job makes every thumbnail, from the
first frame on, and stores them all. The same count, the fixed build against the one before it,
taking turns:

| | Before the fix | After the fix |
| --- | --- | --- |
| A fresh context | 7.0 MB, 6.7 MB received; 8.2 s, 7.0 s | 3.3 MB, 0 MB; 3.3 s, 3.2 s |
| A persistent profile | 7.3 MB; 6.6 s | 0.1 MB; 3.2 s |

The export right after a first visit now finds the 720p files in the cache, as it did before M8.
Why the build before the fix didn't isn't pinned down either: each file has a single key frame
(07-medium's 121 frames have one, at 0 s), so both builds' 720p jobs decode every file from its
first frame.

### The browser matrix

The same `pnpm bench`, after the fixes, in Playwright's WebKit and Firefox engines (`pnpm bench
webkit`, `pnpm bench firefox`; 18:19 and 18:43 below), next to Google Chrome's (17:53). These are
the engines Safari and Firefox are built on, not the browsers: Playwright builds them with their
own media stacks, and the numbers say nothing about the browsers' own settings or hardware paths.

| Measure | Goal | Google Chrome 155 | WebKit engine (Playwright 27.2) | Firefox engine (Playwright 157) |
| --- | --- | --- | --- | --- |
| Drag, trim, zoom: FPS, p95 frame | 60 FPS | 60, 16.7 ms | 60, 18–23 ms (see below) | 120, 8.9–9.2 ms (its headless pages paint at 120 Hz) |
| Slowest interaction while editing | ≤ 100 ms | 56 ms | 24 ms | 16 ms |
| Importing a 1080p clip: the first, then the median | | 220 ms, 69 ms | 479 ms, 289 ms (its thumbnails are JPEG) | 265 ms, 158 ms |
| A picture while dragging, p95: the 1080p files · the story | ≤ 50 ms | 15 ms · 15 ms | 15 ms · 15 ms | 9 ms · 9 ms |
| The exact frame once the pointer rests, p95 (p50): the 1080p files · the story | ≤ 200 ms | 118 ms (46) · 74 ms (41) | 174 ms (109) · 166 ms (105) | **343 ms (122)** · 129 ms (92) |
| A step with →, p95: the 1080p files · the story | | 95 ms · 81 ms | 195 ms · 117 ms | 175 ms · 301 ms |
| Late or dropped frames, worst of 5 play-throughs: the 1080p files · the story | ≤ 1 % | 0 · 0 | 13 of 1,440 (0.9 %) · 0 | 10 of 1,440 (0.7 %) · 10 of 1,080 (0.9 %) |
| Open VideoFrames once paused, and after each export | 0 | 0 | 0 | 0 |
| The story: its clips in · the cut's filmstrips · all thumbnails (first visit) | | 2.0 s · 4.0 s · 18.0 s | 4.5 s · 7.7 s · 16.2 s | 2.6 s · 4.6 s · 23.6 s |
| The export's format, from what the browser encodes | | MP4: H.264, AAC | MP4: H.264, AAC | WebM: VP9, Opus (no AAC encoder) |
| Export at 1080p from the Feed, median of 3 | ≥ 1× real time | 74.8 s, 0.6×: waiting for r2.dev | 71.5 s, 0.6×: waiting for r2.dev; its encoder 12 s | **153.9 s, 0.3×**: its VP9 encoder, 146 s |
| Export at 720p, median of 3 | | 5.6 s, 8.1× | 8.3 s, 5.4× (its encoder 6.5–7.8 s) | 65.6 s, 0.7× (its encoder, 63 s) |
| The output check | | 6 of 6 passed | 6 of 6 | 6 of 6 |
| JS heap, long animation frames | | measured (above) | not available there | not available there |

All three engines run the whole editor: files go into OPFS (WebKit in a persistent profile, as
Safari has it), clips decode with WebCodecs, playback follows the audio clock in every
play-through, autosave writes its slots, and every export passes its output check. Where they
differ:

- **Firefox exports WebM.** Its WebCodecs has no AAC encoder, so the dialog chooses VP9 and Opus,
  as M6 designed, and says why. Its VP9 encoder is the limit: 1080p at 0.3× real time and 720p at
  0.7×, with under 3 s of each export spent waiting for the network. Spec section 2's 1× goal is
  Chrome's, and these are the engine's numbers, not the browser's.
- **Firefox's exact frame on the 1080p files: 343 ms at p95**, over the 200 ms goal: from a key
  frame every 2 s, its decoder takes longer to reach the frame. On the story's 720p files, 129 ms.
- **WebKit drops a few frames** of the two-track 1080p cut, at most 13 of 1,440 (0.9 %) in a
  play-through, inside the goal; none on the story.
- **WebKit's editing gestures are short:** Playwright doesn't pace a page's input to WebKit's
  frames as it does to Chrome's, so its 250 pointer moves arrived in 0.4–0.6 s (Chrome's in about
  4.5 s) and the drag and trim rows rest on 27–35 frames. The zoom, paced by its own waits, had 266.
- **Saves read 0.0 ms in Firefox:** its clock is coarser than a save.

## The Feed tab's cards from the Genframe Kit (2026-10-21)

Measured the way M0 did: `pnpm build`, each file in `dist/assets/` gzipped with Node's default level,
main (a6d4af2) against this branch.

| | Before | After | Change |
| --- | --- | --- | --- |
| First-load JS (the shell), gzip | 114,488 B | 114,489 B | +1 B, 5.5 KB left of 120 KB |
| The Feed tab's chunk (`FeedClips`), gzip | 2,565 B | 6,330 B | +3,765 B: the Kit's card, `thumbhash`'s decoder, `useReducedMotion` |
| CSS, gzip | 7,261 B | 7,768 B | +507 B: the card's classes |

- The shell doesn't change: only the Feed tab's chunk imports the card, and the chunk still imports
  from the shell alone. It loads when the pointer or the keyboard reaches the tab, as before.
- The pool's code isn't in the chunk: the bin plays no previews, so nothing uses
  `VideoPoolProvider`, and the bundler leaves `createVideoPool` out.
- Tests: all 902 unit and component tests, and the end-to-end suite in Chrome and WebKit (124
  passed, 6 skipped as before).

## `pnpm bench` runs

Each `pnpm bench` adds its table here, newest last (`bench/run.ts`).

### 2026-10-19 17:06 · Google Chrome 155.0.8059.84

Apple M1 Pro, 16 GB, macOS 26.6.2, Node v24.8.0. The production build of efeb264 with uncommitted
changes, served at http://localhost:4173; the Feed and its bucket live. Headless, the CPU at full
speed.

| Measure | Goal (spec section 2) | Result | Bench |
| --- | --- | --- | --- |
| First-load JS, gzip | ≤ 120 KB | 115.7 KB (115,690 B) | the build |
| First-load CSS, gzip |  | 7.3 KB (7,261 B) | the build |
| Drag a clip: FPS, p95 frame, long animation frames | 60 FPS | 60, 16.8 ms, 0 | `bench:editing` |
| Trim a clip: FPS, p95 frame, long animation frames | 60 FPS | 60, 16.7 ms, 0 | `bench:editing` |
| Zoom with Ctrl + wheel: FPS, p95 frame, long animation frames | 60 FPS | 60, 16.7 ms, 0 | `bench:editing` |
| Slowest interaction while editing the story, its load's press included | ≤ 100 ms | 56 ms | `bench:editing` |
| Autosave's work on the main thread, per save |  | at most 1.5 ms (2 saves) | `bench:editing` |
| Importing a 1080p 5 s clip, pick to ready: the first, then the median of five more |  | 222 ms, then 71 ms; long animation frames: 0 | `bench:import` |
| A picture while dragging the ruler, p95 (p50): the two-track 1080p cut of files | ≤ 50 ms | 14 ms (12) | `bench:playback` |
| The exact frame after the pointer rests, p95 (p50): the two-track 1080p cut of files | ≤ 200 ms | 215 ms (70) | `bench:playback` |
| Late or dropped frames, worst of 5 play-throughs: the two-track 1080p cut of files | ≤ 1 % | 0 of 1,440 | `bench:playback` |
| Open VideoFrames once paused, after each play-through: the two-track 1080p cut of files | 0 | 0 | `bench:playback` |
| JS heap after each play-through: the two-track 1080p cut of files | no growth | 5.2–5.3 MB | `bench:playback` |
| Long animation frames while playing: the two-track 1080p cut of files |  | 0 | `bench:playback` |
| Robot story: press to its 15 clips on the timeline |  | 3.3 s | `bench:playback story` |
| Robot story, first visit: the cut's filmstrips in (each clip's first 3 s) |  | 16.3 s | `bench:playback story` |
| Robot story, first visit: all 15 filmstrips in |  | 16.4 s | `bench:playback story` |
| A picture while dragging the ruler, p95 (p50): the robot story | ≤ 50 ms | 13 ms (10) | `bench:playback story` |
| The exact frame after the pointer rests, p95 (p50): the robot story | ≤ 200 ms | 99 ms (52) | `bench:playback story` |
| Late or dropped frames, worst of 5 play-throughs: the robot story | ≤ 1 % | 0 of 1,080 | `bench:playback story` |
| Open VideoFrames once paused, after each play-through: the robot story | 0 | 0 | `bench:playback story` |
| JS heap after each play-through: the robot story | no growth | 6.0–6.1 MB | `bench:playback story` |
| Long animation frames while playing: the robot story |  | 0 | `bench:playback story` |
| Export of the 45 s robot story at 1080p, from the live Feed, median of 3 | ≥ 1× real time | 48.6 s, 0.9× real time (MP4 · H.264 video, AAC audio) | `bench:export` |
| Export of the 45 s robot story at 720p, from the live Feed, median of 3 |  | 3.6 s, 12.6× real time (MP4 · H.264 video, AAC audio) | `bench:export` |
| Exports: output check passed, open VideoFrames after, long animation frames |  | 6 of 6, 0, 2 | `bench:export` |

### 2026-10-19 17:53 · Google Chrome 155.0.8059.84

Apple M1 Pro, 16 GB, macOS 26.6.2, Node v24.8.0. The production build of fe301de with uncommitted
changes, served at http://localhost:4173; the Feed and its bucket live. Headless, the CPU at full
speed.

| Measure | Goal (spec section 2) | Result | Bench |
| --- | --- | --- | --- |
| First-load JS, gzip | ≤ 120 KB | 114.4 KB (114,384 B) | the build |
| First-load CSS, gzip |  | 7.3 KB (7,261 B) | the build |
| Drag a clip: FPS, p95 frame, long animation frames | 60 FPS | 60, 16.7 ms, 0 | `bench:editing` |
| Trim a clip: FPS, p95 frame, long animation frames | 60 FPS | 60, 16.7 ms, 0 | `bench:editing` |
| Zoom with Ctrl + wheel: FPS, p95 frame, long animation frames | 60 FPS | 60, 16.7 ms, 0 | `bench:editing` |
| Slowest interaction while editing the story, its load's press included | ≤ 100 ms | 56 ms | `bench:editing` |
| Autosave's work on the main thread, per save |  | at most 2.2 ms (2 saves) | `bench:editing` |
| Importing a 1080p 5 s clip, pick to ready: the first, then the median of five more |  | 220 ms, then 69 ms; long animation frames: 0 | `bench:import` |
| A picture while dragging the ruler, p95 (p50): the two-track 1080p cut of files | ≤ 50 ms | 15 ms (12) | `bench:playback` |
| The exact frame after the pointer rests, p95 (p50): the two-track 1080p cut of files | ≤ 200 ms | 118 ms (46) | `bench:playback` |
| Late or dropped frames, worst of 5 play-throughs: the two-track 1080p cut of files | ≤ 1 % | 0 of 1,440 | `bench:playback` |
| Open VideoFrames once paused, after each play-through: the two-track 1080p cut of files | 0 | 0 | `bench:playback` |
| JS heap after each play-through: the two-track 1080p cut of files | no growth | 5.2–5.3 MB | `bench:playback` |
| Long animation frames while playing: the two-track 1080p cut of files |  | 0 | `bench:playback` |
| Robot story: press to its 15 clips on the timeline |  | 2.0 s | `bench:playback story` |
| Robot story, first visit: the cut's filmstrips in (each clip's first 3 s) |  | 4.0 s | `bench:playback story` |
| Robot story, first visit: all 15 filmstrips in |  | 18.0 s | `bench:playback story` |
| A picture while dragging the ruler, p95 (p50): the robot story | ≤ 50 ms | 15 ms (13) | `bench:playback story` |
| The exact frame after the pointer rests, p95 (p50): the robot story | ≤ 200 ms | 74 ms (41) | `bench:playback story` |
| Late or dropped frames, worst of 5 play-throughs: the robot story | ≤ 1 % | 0 of 1,080 | `bench:playback story` |
| Open VideoFrames once paused, after each play-through: the robot story | 0 | 0 | `bench:playback story` |
| JS heap after each play-through: the robot story | no growth | 6.1 MB | `bench:playback story` |
| Long animation frames while playing: the robot story |  | 1 | `bench:playback story` |
| Export of the 45 s robot story at 1080p, from the live Feed, median of 3 | ≥ 1× real time | 74.8 s, 0.6× real time (MP4 · H.264 video, AAC audio) | `bench:export` |
| Export of the 45 s robot story at 720p, from the live Feed, median of 3 |  | 5.6 s, 8.1× real time (MP4 · H.264 video, AAC audio) | `bench:export` |
| Exports: output check passed, open VideoFrames after, long animation frames |  | 6 of 6, 0, 0 | `bench:export` |

### 2026-10-19 18:19 · WebKit engine (Playwright) 27.2

Apple M1 Pro, 16 GB, macOS 26.6.2, Node v24.8.0. The production build of fe301de with uncommitted
changes, served at http://localhost:4173; the Feed and its bucket live. Headless, the CPU at full
speed.

| Measure | Goal (spec section 2) | Result | Bench |
| --- | --- | --- | --- |
| First-load JS, gzip | ≤ 120 KB | 114.4 KB (114,384 B) | the build |
| First-load CSS, gzip |  | 7.3 KB (7,261 B) | the build |
| Drag a clip: FPS, p95 frame, long animation frames | 60 FPS | 60, 23.0 ms, not reported | `bench:editing` |
| Trim a clip: FPS, p95 frame, long animation frames | 60 FPS | 60, 18.0 ms, not reported | `bench:editing` |
| Zoom with Ctrl + wheel: FPS, p95 frame, long animation frames | 60 FPS | 60, 21.0 ms, not reported | `bench:editing` |
| Slowest interaction while editing the story, its load's press included | ≤ 100 ms | 24 ms | `bench:editing` |
| Autosave's work on the main thread, per save |  | at most 1.0 ms (3 saves) | `bench:editing` |
| Importing a 1080p 5 s clip, pick to ready: the first, then the median of five more |  | 479 ms, then 289 ms; long animation frames: not reported | `bench:import` |
| A picture while dragging the ruler, p95 (p50): the two-track 1080p cut of files | ≤ 50 ms | 15 ms (8) | `bench:playback` |
| The exact frame after the pointer rests, p95 (p50): the two-track 1080p cut of files | ≤ 200 ms | 174 ms (109) | `bench:playback` |
| Late or dropped frames, worst of 5 play-throughs: the two-track 1080p cut of files | ≤ 1 % | 13 of 1,440 | `bench:playback` |
| Open VideoFrames once paused, after each play-through: the two-track 1080p cut of files | 0 | 0 | `bench:playback` |
| JS heap after each play-through: the two-track 1080p cut of files | no growth | not measurable here | `bench:playback` |
| Long animation frames while playing: the two-track 1080p cut of files |  | not reported | `bench:playback` |
| Robot story: press to its 15 clips on the timeline |  | 4.5 s | `bench:playback story` |
| Robot story, first visit: the cut's filmstrips in (each clip's first 3 s) |  | 7.7 s | `bench:playback story` |
| Robot story, first visit: all 15 filmstrips in |  | 16.2 s | `bench:playback story` |
| A picture while dragging the ruler, p95 (p50): the robot story | ≤ 50 ms | 15 ms (9) | `bench:playback story` |
| The exact frame after the pointer rests, p95 (p50): the robot story | ≤ 200 ms | 166 ms (105) | `bench:playback story` |
| Late or dropped frames, worst of 5 play-throughs: the robot story | ≤ 1 % | 0 of 1,080 | `bench:playback story` |
| Open VideoFrames once paused, after each play-through: the robot story | 0 | 0 | `bench:playback story` |
| JS heap after each play-through: the robot story | no growth | not measurable here | `bench:playback story` |
| Long animation frames while playing: the robot story |  | not reported | `bench:playback story` |
| Export of the 45 s robot story at 1080p, from the live Feed, median of 3 | ≥ 1× real time | 71.5 s, 0.6× real time (MP4 · H.264 video, AAC audio) | `bench:export` |
| Export of the 45 s robot story at 720p, from the live Feed, median of 3 |  | 8.3 s, 5.4× real time (MP4 · H.264 video, AAC audio) | `bench:export` |
| Exports: output check passed, open VideoFrames after, long animation frames |  | 6 of 6, 0, not reported | `bench:export` |

### 2026-10-19 18:43 · Firefox engine (Playwright) 157.0

Apple M1 Pro, 16 GB, macOS 26.6.2, Node v24.8.0. The production build of fe301de with uncommitted
changes, served at http://localhost:4173; the Feed and its bucket live. Headless, the CPU at full
speed.

| Measure | Goal (spec section 2) | Result | Bench |
| --- | --- | --- | --- |
| First-load JS, gzip | ≤ 120 KB | 114.4 KB (114,384 B) | the build |
| First-load CSS, gzip |  | 7.3 KB (7,261 B) | the build |
| Drag a clip: FPS, p95 frame, long animation frames | 60 FPS | 120, 8.9 ms, not reported | `bench:editing` |
| Trim a clip: FPS, p95 frame, long animation frames | 60 FPS | 120, 9.2 ms, not reported | `bench:editing` |
| Zoom with Ctrl + wheel: FPS, p95 frame, long animation frames | 60 FPS | 120, 9.1 ms, not reported | `bench:editing` |
| Slowest interaction while editing the story, its load's press included | ≤ 100 ms | 16 ms | `bench:editing` |
| Autosave's work on the main thread, per save |  | at most 0.0 ms (2 saves) | `bench:editing` |
| Importing a 1080p 5 s clip, pick to ready: the first, then the median of five more |  | 265 ms, then 158 ms; long animation frames: not reported | `bench:import` |
| A picture while dragging the ruler, p95 (p50): the two-track 1080p cut of files | ≤ 50 ms | 9 ms (6) | `bench:playback` |
| The exact frame after the pointer rests, p95 (p50): the two-track 1080p cut of files | ≤ 200 ms | 343 ms (122) | `bench:playback` |
| Late or dropped frames, worst of 5 play-throughs: the two-track 1080p cut of files | ≤ 1 % | 10 of 1,440 | `bench:playback` |
| Open VideoFrames once paused, after each play-through: the two-track 1080p cut of files | 0 | 0 | `bench:playback` |
| JS heap after each play-through: the two-track 1080p cut of files | no growth | not measurable here | `bench:playback` |
| Long animation frames while playing: the two-track 1080p cut of files |  | not reported | `bench:playback` |
| Robot story: press to its 15 clips on the timeline |  | 2.6 s | `bench:playback story` |
| Robot story, first visit: the cut's filmstrips in (each clip's first 3 s) |  | 4.6 s | `bench:playback story` |
| Robot story, first visit: all 15 filmstrips in |  | 23.6 s | `bench:playback story` |
| A picture while dragging the ruler, p95 (p50): the robot story | ≤ 50 ms | 9 ms (6) | `bench:playback story` |
| The exact frame after the pointer rests, p95 (p50): the robot story | ≤ 200 ms | 129 ms (92) | `bench:playback story` |
| Late or dropped frames, worst of 5 play-throughs: the robot story | ≤ 1 % | 10 of 1,080 | `bench:playback story` |
| Open VideoFrames once paused, after each play-through: the robot story | 0 | 0 | `bench:playback story` |
| JS heap after each play-through: the robot story | no growth | not measurable here | `bench:playback story` |
| Long animation frames while playing: the robot story |  | not reported | `bench:playback story` |
| Export of the 45 s robot story at 1080p, from the live Feed, median of 3 | ≥ 1× real time | 153.9 s, 0.3× real time (WebM · VP9 video, Opus audio) | `bench:export` |
| Export of the 45 s robot story at 720p, from the live Feed, median of 3 |  | 65.6 s, 0.7× real time (WebM · VP9 video, Opus audio) | `bench:export` |
| Exports: output check passed, open VideoFrames after, long animation frames |  | 6 of 6, 0, not reported | `bench:export` |
