// Property tests: fast-check makes random projects and random sequences of edits, and checks
// that no sequence ever breaks a rule, that each edit does what it promises and nothing else,
// and that undo always restores the exact project it replaced. When a property fails,
// fast-check shrinks the case to a short one and prints it with its seed.

import fc from "fast-check";
import { describe, expect, test } from "vitest";
import * as commands from "../../src/engine/commands.ts";
import { clipEnd, createProject, findClip } from "../../src/engine/project.ts";
import { createDocumentStore, type DocumentStore } from "../../src/engine/store.ts";
import { sourceFrameAt } from "../../src/engine/time.ts";
import type { Clip, Fps, Project } from "../../src/engine/types.ts";
import { audioAsset, frozen, videoAsset } from "./fixtures.ts";
import { invariantViolations } from "../../src/engine/invariants.ts";

/**
 * An empty project at a random rate, with up to five sources from 0.01 s to 12 s long, counted
 * in whole microseconds so the lengths spread evenly (`fc.double` favors tiny values), and rarely
 * a whole number of frames.
 */
const randomProject = fc
  .record({
    fps: fc.constantFrom<Fps>(24, 25, 30),
    sources: fc.array(
      fc.record({
        kind: fc.constantFrom("video", "audio"),
        durationSec: fc.integer({ min: 10_000, max: 12_000_000 }).map((us) => us / 1_000_000),
      }),
      { minLength: 1, maxLength: 5 },
    ),
  })
  .map(({ fps, sources }) =>
    createProject({
      id: "random",
      fps,
      assets: sources.map(({ kind, durationSec }, index) =>
        kind === "video"
          ? videoAsset(`v${index}`, durationSec)
          : audioAsset(`a${index}`, durationSec),
      ),
    }),
  );

/** Mostly whole frames; now and then half a frame off, to try the whole-frames check. */
const frames = (min: number, max: number) =>
  fc.oneof(
    { weight: 19, arbitrary: fc.integer({ min, max }) },
    { weight: 1, arbitrary: fc.integer({ min, max }).map((value) => value + 0.5) },
  );

/**
 * Where an edit puts a clip's edge: some frames from where it is now, or a few frames before or
 * after another clip (a negative gap overlaps it), so edits often meet their neighbors edge to
 * edge, where off-by-one bugs live.
 */
const place = fc.oneof(
  fc.record({ by: frames(-200, 200) }),
  fc.record({ near: fc.nat(), side: fc.constantFrom("before", "after"), gap: frames(-2, 2) }),
);

/**
 * An edit, described so it can apply to whatever the project holds by then: clips and tracks
 * are picked by index, and positions are relative to clips, so that edges, neighbors and source
 * limits come up often.
 */
const randomEdit = fc.oneof(
  fc.record({
    type: fc.constant("add"),
    asset: fc.nat(),
    track: fc.nat(),
    start: frames(-2, 400),
    in: fc.option(frames(-2, 150), { nil: undefined }),
    duration: fc.option(frames(-1, 150), { nil: undefined }),
  }),
  fc.record({
    type: fc.constant("move"),
    clip: fc.nat(),
    place,
    track: fc.option(fc.nat(), { nil: undefined }),
  }),
  fc.record({ type: fc.constant("trimStart"), clip: fc.nat(), place }),
  fc.record({ type: fc.constant("trimEnd"), clip: fc.nat(), place }),
  fc.record({ type: fc.constant("split"), clip: fc.nat(), at: frames(-2, 150) }),
  fc.record({ type: fc.constant("delete"), clips: fc.array(fc.nat(), { maxLength: 3 }) }),
);

type Edit = typeof randomEdit extends fc.Arbitrary<infer T> ? T : never;
type Place = typeof place extends fc.Arbitrary<infer T> ? T : never;

/** Up to `maxLength` edits. Without `size: "max"`, fast-check makes arrays of at most 10. */
const editSequence = (maxLength: number) => fc.array(randomEdit, { maxLength, size: "max" });

/** An edit turned into a command with real ids and frames for the project as it is now. */
type Command =
  | { name: "addClip"; args: commands.AddClipArgs }
  | { name: "moveClip"; args: commands.MoveClipArgs }
  | { name: "trimStart"; args: commands.TrimStartArgs }
  | { name: "trimEnd"; args: commands.TrimEndArgs }
  | { name: "split"; args: commands.SplitArgs }
  | { name: "deleteClips"; args: commands.DeleteClipsArgs };

function toCommand(project: Project, edit: Edit, newId: string): Command {
  const clips = project.tracks.flatMap((track) => track.clips);
  const pick = (index: number): Clip | undefined => clips[index % Math.max(clips.length, 1)];
  const trackId = (index: number) => project.tracks[index % project.tracks.length]?.id ?? "V1";
  const missing: Clip = { id: "missing", assetId: "missing", start: 0, in: 0, duration: 1 };
  /** The frame a placement names, given where the edge is now. */
  const frameFor = (edge: number, at: Place) => {
    if ("by" in at) return edge + at.by;
    const other = pick(at.near) ?? missing;
    return at.side === "before" ? other.start - at.gap : clipEnd(other) + at.gap;
  };

  switch (edit.type) {
    case "add": {
      const assetIds = Object.keys(project.assets);
      const assetId = assetIds[edit.asset % assetIds.length] ?? "missing";
      const { start, in: inPoint, duration } = edit;
      const track = trackId(edit.track);
      return {
        name: "addClip",
        args: { clipId: newId, assetId, trackId: track, start, in: inPoint, duration },
      };
    }
    case "move": {
      // Next to another clip, the move goes to that clip's track: its end meets the other's
      // start, or its start meets the other's end.
      const clip = pick(edit.clip) ?? missing;
      if ("by" in edit.place) {
        const track = edit.track === undefined ? undefined : trackId(edit.track);
        const start = frameFor(clip.start, edit.place);
        return { name: "moveClip", args: { clipId: clip.id, start, trackId: track } };
      }
      const other = pick(edit.place.near) ?? missing;
      const edge = frameFor(clip.start, edit.place);
      const start = edit.place.side === "before" ? edge - clip.duration : edge;
      const track = findClip(project, other.id)?.track.id;
      return { name: "moveClip", args: { clipId: clip.id, start, trackId: track } };
    }
    case "trimStart": {
      const clip = pick(edit.clip) ?? missing;
      const start = frameFor(clip.start, edit.place);
      return { name: "trimStart", args: { clipId: clip.id, start } };
    }
    case "trimEnd": {
      const clip = pick(edit.clip) ?? missing;
      const end = frameFor(clipEnd(clip), edit.place);
      return { name: "trimEnd", args: { clipId: clip.id, end } };
    }
    case "split": {
      const clip = pick(edit.clip) ?? missing;
      const at = clip.start + edit.at;
      return { name: "split", args: { clipId: clip.id, at, rightClipId: newId } };
    }
    case "delete": {
      const clipIds = edit.clips.map((index) => (pick(index) ?? missing).id);
      return { name: "deleteClips", args: { clipIds } };
    }
  }
}

function run(project: Project, command: Command): commands.CommandResult {
  switch (command.name) {
    case "addClip":
      return commands.addClip(project, command.args);
    case "moveClip":
      return commands.moveClip(project, command.args);
    case "trimStart":
      return commands.trimStart(project, command.args);
    case "trimEnd":
      return commands.trimEnd(project, command.args);
    case "split":
      return commands.split(project, command.args);
    case "deleteClips":
      return commands.deleteClips(project, command.args);
  }
}

/** The same edit through the store's actions, which make their own ids. */
function runInStore(store: DocumentStore, command: Command): commands.CommandResult {
  const edit = store.getState();
  switch (command.name) {
    case "addClip": {
      const { assetId, trackId, start, in: inPoint, duration } = command.args;
      return edit.addClip({ assetId, trackId, start, in: inPoint, duration });
    }
    case "moveClip":
      return edit.moveClip(command.args);
    case "trimStart":
      return edit.trimStart(command.args);
    case "trimEnd":
      return edit.trimEnd(command.args);
    case "split":
      return edit.split({ clipId: command.args.clipId, at: command.args.at });
    case "deleteClips":
      return edit.deleteClips(command.args);
  }
}

function clipIn(project: Project, clipId: string): Clip {
  const clip = findClip(project, clipId)?.clip;
  if (!clip) throw new Error(`No clip ${clipId}`);
  return clip;
}

/** The clips an edit is about: the ones it changes, adds or deletes. */
function touchedIds(command: Command): Set<string> {
  switch (command.name) {
    case "split":
      return new Set([command.args.clipId, command.args.rightClipId]);
    case "deleteClips":
      return new Set(command.args.clipIds);
    default:
      return new Set([command.args.clipId]);
  }
}

/** Every clip an edit isn't about, on every track, in order, so none is lost or changed. */
function otherClips(project: Project, touched: Set<string>) {
  return project.tracks.map((track) => ({
    track: track.id,
    clips: track.clips.filter((clip) => !touched.has(clip.id)),
  }));
}

/**
 * Checks that a successful edit did what it says, beyond keeping the rules, and left every
 * other clip exactly as it was.
 */
function expectPromiseKept(before: Project, after: Project, command: Command): void {
  const touched = touchedIds(command);
  expect(otherClips(after, touched)).toEqual(otherClips(before, touched));

  switch (command.name) {
    case "addClip": {
      const { clipId, assetId, trackId, start } = command.args;
      expect(findClip(after, clipId)).toMatchObject({
        track: { id: trackId },
        clip: { assetId, start },
      });
      break;
    }
    case "moveClip": {
      const { clipId, start, trackId } = command.args;
      const old = clipIn(before, clipId);
      expect(clipIn(after, clipId)).toEqual({ ...old, start });
      if (trackId !== undefined) expect(findClip(after, clipId)?.track.id).toBe(trackId);
      break;
    }
    case "trimStart":
    case "trimEnd": {
      // Every frame the clip covers both before and after still shows the same source frame.
      const old = clipIn(before, command.args.clipId);
      const trimmed = clipIn(after, command.args.clipId);
      if (command.name === "trimStart") expect(clipEnd(trimmed)).toBe(clipEnd(old));
      else expect([trimmed.start, trimmed.in]).toEqual([old.start, old.in]);
      const end = Math.min(clipEnd(old), clipEnd(trimmed));
      for (let frame = Math.max(old.start, trimmed.start); frame < end; frame++) {
        expect(sourceFrameAt(trimmed, frame)).toBe(sourceFrameAt(old, frame));
      }
      break;
    }
    case "split": {
      // The two halves show, frame for frame, what the clip showed.
      const { clipId, rightClipId } = command.args;
      const old = clipIn(before, clipId);
      const [left, right] = [clipIn(after, clipId), clipIn(after, rightClipId)];
      expect([left.start, clipEnd(left), clipEnd(right)]).toEqual([
        old.start,
        right.start,
        clipEnd(old),
      ]);
      for (let frame = old.start; frame < clipEnd(old); frame++) {
        const shown = sourceFrameAt(left, frame) ?? sourceFrameAt(right, frame);
        expect(shown).toBe(sourceFrameAt(old, frame));
      }
      break;
    }
    case "deleteClips":
      for (const clipId of command.args.clipIds) expect(findClip(after, clipId)).toBeUndefined();
      break;
  }
}

describe("random edits on random projects", () => {
  test("never break a rule, and each does what it promises", () => {
    const tried = new Map<string, number>();
    const done = new Map<string, number>();

    fc.assert(
      fc.property(randomProject, editSequence(60), (start, edits) => {
        let project = frozen(start);
        edits.forEach((edit, index) => {
          const command = toCommand(project, edit, `new-${index}`);
          tried.set(command.name, (tried.get(command.name) ?? 0) + 1);
          const result = run(project, command);
          if (!result.ok) return;

          expect(invariantViolations(result.project)).toEqual([]);
          expectPromiseKept(project, result.project, command);
          if (result.project !== project) done.set(command.name, (done.get(command.name) ?? 0) + 1);
          project = frozen(result.project);
        });
      }),
      { numRuns: 300 },
    );

    // Not a vacuous pass: each kind of edit changed the project many times (about 100 to 300 in
    // 300 runs) and failed many more.
    for (const name of ["addClip", "moveClip", "trimStart", "trimEnd", "split", "deleteClips"]) {
      const changed = done.get(name) ?? 0;
      expect(changed, `${name} edits that changed the project`).toBeGreaterThan(25);
      expect(tried.get(name) ?? 0, `${name} edits tried`).toBeGreaterThan(2 * changed);
    }
  });
});

describe("undo", () => {
  test("restores the exact project an edit replaced, and redo the edited one", () => {
    fc.assert(
      fc.property(randomProject, editSequence(40), (start, edits) => {
        const store = createDocumentStore(start);
        const steps = [start];

        for (const edit of edits) {
          const before = store.getState().project;
          const snapshot = structuredClone(before);
          const pastSteps = store.temporal.getState().pastStates.length;

          runInStore(store, toCommand(before, edit, "ignored"));
          const after = store.getState().project;
          if (after === before) {
            // A failed or no-op edit leaves no step.
            expect(store.temporal.getState().pastStates).toHaveLength(pastSteps);
            continue;
          }
          expect(store.temporal.getState().pastStates).toHaveLength(pastSteps + 1);
          steps.push(after);

          store.getState().undo();
          expect(store.getState().project).toBe(before);
          expect(store.getState().project).toEqual(snapshot);
          store.getState().redo();
          expect(store.getState().project).toBe(after);
        }

        // All the way back, then all the way forward again.
        for (let step = steps.length - 2; step >= 0; step--) {
          store.getState().undo();
          expect(store.getState().project).toBe(steps[step]);
        }
        for (let step = 1; step < steps.length; step++) {
          store.getState().redo();
          expect(store.getState().project).toBe(steps[step]);
        }
      }),
      { numRuns: 200 },
    );
  });
});
