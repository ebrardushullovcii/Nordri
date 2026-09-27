import { describe, expect, it } from "vitest";
import {
  inferFileKindForQuestion,
  profileFilesHref,
} from "./job-finder-route-hrefs";

describe("profileFilesHref", () => {
  it("opens Files with the kind the form asked for", () => {
    expect(
      profileFilesHref(
        inferFileKindForQuestion({
          kind: "other",
          prompt: "Academic transcript",
        }),
      ),
    ).toBe("/job-finder/profile?section=files&kind=transcript");
    expect(
      inferFileKindForQuestion({ kind: "portfolio", prompt: "Work links" }),
    ).toBe("portfolio");
    expect(
      inferFileKindForQuestion({ kind: "other", prompt: "Certificate" }),
    ).toBe("certificate");
    expect(profileFilesHref(null)).toBe("/job-finder/profile?section=files");
    expect(profileFilesHref(["portfolio", "transcript", "portfolio"])).toBe(
      "/job-finder/profile?section=files&kind=portfolio,transcript",
    );
  });
});
