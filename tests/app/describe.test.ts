import { expect, test } from "vitest";
import { describeContents } from "../../src/app/describe.ts";
import { createProject } from "../../src/engine/project.ts";
import { clip, storyProject, withClips } from "../engine/fixtures.ts";

test("the toolbar counts the video clips, and says when there's music", () => {
  const story = storyProject();
  expect(describeContents(story)).toBe("2 clips and music");
  expect(describeContents(withClips(story, { A1: [] }))).toBe("2 clips");
  expect(describeContents(withClips(story, { V1: [clip("x", "07-medium")], A1: [] }))).toBe(
    "1 clip",
  );
  expect(describeContents(withClips(story, { V1: [] }))).toBe("Music");
  expect(describeContents(createProject({ id: "empty" }))).toBeNull();
});
