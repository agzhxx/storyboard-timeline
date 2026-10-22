# Storyboard Timeline: design

The visual design for M2 onward. Build the UI to match these boards pixel for pixel.

| What | Where |
| --- | --- |
| Shared tokens, copied from the Feed | [src/app/tokens.css](../../src/app/tokens.css) |
| Editor tokens | [src/app/editor-tokens.css](../../src/app/editor-tokens.css) |
| Contrast checks | [tests/tokens.test.ts](../../tests/tokens.test.ts) |

## Boards on the canvas

| Board | Shows |
| --- | --- |
| Editor · the robot story | The whole editor at 1440 × 900: the demo cut, 07-medium selected, the playhead at 00:00:19:06 |
| Editor · empty project | "Start a cut" with Load the robot story and Add your own files; an empty bin, inspector and tracks |
| Clip states | Default, hover, selected, several selected, keyboard focus, dragging, snapping, trimming, a trim at its limit, split, one frame long, can't decode, dropping from the bin, audio |
| Toolbar, ruler and playhead | Toolbar states (snapping off, an undo step, no encoder); the ruler at fit, 2 px and 24 px per frame; the playhead at rest and while scrubbing |
| Media bin states | Every import state, files dragged over the bin, the Feed tab loaded with a hovered card, loading, unreachable, offline |
| Inspector states | Nothing selected, a video clip with the playhead field focused, the music clip with a timecode that doesn't parse, several clips |
| Export: settings, progress, done | The export dialog at each step, ending with the output check |
| Export: fallback, failed, canceled | WebM when H.264 can't be encoded, a failed export, a canceled one, a Feed clip that can't be read |
| Messages and monitor states | Coarse and exact scrub, loading after a jump, a decode error, save status, toasts, the new-project confirmation |
| Keyboard shortcuts (?) | The key map from spec sections 3.2 and 3.3 |
| Phone · read-only | 390 × 844: the monitor, a filmstrip of the whole cut, "Editing works best on a laptop" |
| Perf overlay (?perf=1) | The counters from spec section 4.8 over the monitor |

The media is real: one frame from each of the 15 story clips. File sizes, export speeds and perf
values on the boards are examples, not measurements.

## Key choices

**The media is the brightest thing on screen.** Panels use the Feed's near-black greys; the only
bright areas are the monitor and the clips' filmstrips.

**One accent, with fixed jobs.** Ember marks the playhead, the selection, keyboard focus and
primary buttons. A snap line is white, so it never reads as the playhead. Danger red is only for
error icons; error text stays white.

**Whole frames, drawn.** At the default zoom a frame is 2 px wide, so the 45 s demo cut (1,080
frames at 24 fps) is 2,160 px long. Timecodes are `HH:MM:SS:FF` in the monospace font with
tabular figures, so they don't jitter during playback.

**Clips.** Radius 4 px. A clip shows a filmstrip (one thumbnail per second of source, repeated
when zoomed in) and its name on the Feed's 72 % scrim. Trim handles are 6 px wide, 8 px while
dragged; white on hover, Ember when the clip is selected. A one-frame clip is drawn at least 4 px
wide, without a label.

**Snapping.** Within 8 px, an edge snaps to the playhead, another clip's edge or 0, and a 1 px
white line shows it across the tracks. Alt drags freely; N turns snapping off.

**Ruler labels never collide.** At fit, a label every 5 s; at 2 px per frame, every 2 s; at
24 px per frame, every 6 frames, with a tick per frame and the playhead covering its whole frame.

**Focus ring.** 2 px Ember with a 2 px gap, the same as the Feed (`src/app/globals.css`).

**Messages say what still works.** Each one names what happened and what the user can still do,
for example "Your own files and the timeline keep working."

**Additions beyond the spec**: a slim app bar (project name, save
status, New project, `?`), an "Add ↵" button on a hovered Feed card, an undo toast after a
delete, and "Play from the next clip" after a decode error.

## Tokens

The palette, type scale, radii, control height and motion are the Feed's: see
`src/app/tokens.css`. The editor adds these in `src/app/editor-tokens.css`:

| Token | Value | Utility | Used for |
| --- | --- | --- | --- |
| `--spacing-appbar` | 44 px | `h-appbar` | App bar |
| `--spacing-toolbar` | 44 px | `h-toolbar` | Timeline toolbar |
| `--spacing-bin` | 300 px | `w-bin` | Media bin |
| `--spacing-inspector` | 280 px | `w-inspector` | Inspector |
| `--spacing-track-header` | 88 px | `w-track-header` | V2 / V1 / A1 labels |
| `--spacing-ruler` | 28 px | `h-ruler` | Ruler |
| `--spacing-track-v2` | 72 px | `h-track-v2` | Track V2 |
| `--spacing-track-v1` | 88 px | `h-track-v1` | Track V1, the main one |
| `--spacing-track-a1` | 72 px | `h-track-a1` | Track A1 |
| `--spacing-trim-handle` | 6 px | `w-trim-handle` | Trim handles at rest |
| `--radius-clip` | 4 px | `rounded-clip` | Clips |
| `--color-playhead` | accent | `bg-playhead` | Playhead line and head |
| `--color-selection` | accent | `ring-selection` | Selection ring and handles |
| `--color-snap` | fg | `bg-snap` | Snap line |
| `--color-clip` | surface-raised | `bg-clip` | A clip's body, behind its filmstrip |
| `--color-waveform` | fg-subtle | canvas (`WAVEFORM_COLORS`) | Waveforms |
| `--color-waveform-selected` | fg-muted | canvas (`WAVEFORM_COLORS`) | A selected clip's waveform |
| `--color-tick`, `--color-tick-major` | line, line-strong | `bg-tick`, `bg-tick-major` | Ruler ticks |
| `--color-monitor` | #000000 | `bg-monitor` | The program monitor's canvas |

**Layout at 1440 × 900:** app bar 44 · panels (bin 300 | monitor | inspector 280) · toolbar 44 ·
timeline (ruler 28, V2 72, V1 88, A1 72, then the scroll bar). The panels take the height that's
left; the monitor's 16:9 canvas is letterboxed in black.

**Contrast:** `tests/tokens.test.ts` checks every text color on every surface (at least 4.5:1)
and every mark the editor draws (playhead, selection, focus, snap line, waveform, major ticks,
input borders, error icons) at 3:1 or more. A token change that breaks one fails CI.

## Using the tokens in code

```tsx
<div className="h-track-v1 border-b border-surface-raised">
  <div className="absolute inset-y-1 rounded-clip bg-clip">…</div>
</div>
<div className="absolute inset-y-0 w-px bg-playhead" />
<span className="font-mono tabular-nums">00:00:19:06</span>
```

## Icons

The canvas draws its icons as inline SVG: a 24 × 24 view box, 1.75 px stroke (2 px at 14 px),
round caps and joins, `currentColor`. M2 draws them the same way, as small components in
`src/app/icons.tsx`, with no icon library.

## Where the editor differs from the boards

- The bin's tabs are a tab list (arrow keys between them), drawn as the board's two buttons.
- The Feed tab's states that the boards don't draw: "No clips in this collection yet." for an empty
  collection; under a list with more pages, "Load more clips" (the next page also loads as it
  comes into view), "Loading more clips…", or "Couldn't load more clips." with Retry; and the
  footer counts what's in ("24 of 35 clips loaded · …") until every page is. A card being added
  shows a spinner in its Add pill until its file's facts are in. The offline state is M7's.
- "Load the robot story" says "Loading the robot story…" with a spinner while it loads.
- The music's inspector says "Demo music" and "Audio · 45.97 s"; the board's "[Demo music · CC0]"
  and "MP3 · stereo" wait for a CC0 track.
- A Feed clip's source line says its file's real length, "5.04 s", where the board rounds to "5 s".
- A file waiting its turn in the import queue says "Waiting to be read… can't be placed yet"; the
  board draws no waiting row.
- A waveform's bars show each stretch's real lowest and highest sample, so they aren't mirrored
  about the middle like the boards' sample data.
- The Messages board's monitor tiles carry the playhead's timecode in a chip at the bottom left;
  the monitor doesn't, as on the Main board, since the transport shows it.
- After a jump, the picture dims and the spinner shows only if the frame takes over 120 ms, so
  stepping through frames doesn't flicker.
- The boards draw no Pause button: it's two filled bars, the Play triangle's weight.
- The perf overlay has a ninth row after the board's eight: M2's slowest interaction, for INP.
- The active track's name is white, so it's clear which track S splits on.
- The zoom slider's knob sits where the zoom is between fit and 48 px per frame on a log scale, so
  at 2 px per frame it's near the left end, not in the middle as drawn.
- The empty project's ruler is at 2 px per frame, labeled every 2 s, where the board draws 4 px
  per frame at 30 fps, labeled every second.
- The export dialog's fallback (WebM) keeps the two size buttons and "Made on this device. Nothing
  is uploaded.", where the board draws the size as a row and the buttons alone: the browser is
  asked again for each size, so the other size has to stay within reach.
- The export dialog's states the boards don't draw: "Checking what this browser can encode…" while
  the browser is asked; "None at this size" with why, and Export off, when neither MP4 nor WebM
  encodes; "MP4 · H.264 video" for a cut without music; WebM's note saying "MP4's AAC audio" when
  only AAC is missing; "Starting…" before there's a time left and "Finishing the file…" after the
  last frame; a failed output check with the warning mark and what didn't hold; failures other than
  the encoder's ("07-medium couldn't be decoded at frame 432", "The file couldn't be finished"); and
  "Export stopped: Demo music couldn't be read…" for the music.
- The estimate for the robot story reads "About 37 MB" ((6.5 + 0.16) Mbit/s × 45 s); the board's
  "About 38 MB" and "38.2 MB" are examples. A file under a megabyte shows kilobytes ("25 KB").
- "Export unavailable" shows its explanation on hover and on focus; the board draws it open.
- A failure's details give the encoder's full codec string ("avc1.640028"), where the board writes
  "avc1".
- Saving's states the boards don't draw: no status for a new project with nothing to save (as the
  empty project's board has it), "Not saved: this browser won't store files" (a private window),
  "Not saved: storage didn't answer", and, before any save, the storage-full toast's "Nothing could
  be saved yet." in place of "Your last save, from 14:32, is safe."
- New project's confirmation says only what there is to remove: "The robot story will be removed…"
  without files, "The files you added will be removed…" without a project; with nothing at all, New
  project starts afresh without asking, unless saving failed: then it asks, with "Your last save
  will be removed…".
- A saved project that couldn't be opened at startup (storage didn't answer) gets a problem toast,
  as storage full does: "Couldn't open the saved project", "This browser's storage didn't answer, so
  nothing is saved for now. Reload to try again.", and Retry, which reloads.
- The shortcuts dialog adds a seventh group at the end of the right column, "Editing with the
  keyboard": Tab to the clips and their handles, Enter, the handles' arrows and Home and End, and
  ⌥ with the arrows to nudge. It scrolls inside a window shorter than itself.
- A selected clip's trim handles take presses 24 px across their edge (WCAG 2.2's minimum target),
  drawn 6 px as before.
- A ready file in My files shows Remove on hover and focus, as the failed rows have it.
- Offline, the note sits under the Collection picker; the cards that need a connection keep their
  AI badge and length, with "Offline" at the bottom left.
- A clip whose file's copy is gone from storage gets the decode error's badge, named "File missing",
  and the monitor says "Can't find 05-wide.mp4" with Play from the next clip.
- The phone view's filmstrip gives each stretch of the cut its share of the width (the story's clips
  are all 3 s, so they're equal, as drawn); with nothing saved, the monitor says "Nothing is saved in
  this browser yet." with Play the robot story. The credits say "15 AI clips from the Generation
  Feed · Demo music" where the board has "[Demo music · CC0]".
- A second tab of the app shows "Your project is open in another tab" with Use it here, in the empty
  state's look; the boards don't draw it.
