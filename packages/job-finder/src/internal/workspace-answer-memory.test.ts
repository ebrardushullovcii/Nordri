import { expect, test } from "vitest";
import {
  createReusableAnswerForQuestion,
  eligibilityAnswerScope,
} from "./workspace-answer-memory";

test.each(["work_authorization", "visa_sponsorship"] as const)(
  "saved %s keeps its question clean and location structured",
  (kind) => {
    const build = (location: string) =>
      createReusableAnswerForQuestion({
        answer: "Yes",
        kind,
        prompt: "Are you eligible?",
        applicationScope: eligibilityAnswerScope({
          kind,
          resultId: "result",
          applicationRecordId: "application",
          location,
        }),
      });
    const first = build("Toronto, Canada");
    expect(first.question).toBe("Are you eligible?");
    expect(first.label).toBe("Are you eligible?");
    expect(first.applicationScope?.location).toBe("Toronto, Canada");
    expect(first.id).not.toBe(build("Boston, United States").id);
  },
);

test("ordinary consent has no invented location scope", () => {
  expect(
    eligibilityAnswerScope({
      kind: "other",
      resultId: "result",
      applicationRecordId: "application",
      location: "London",
    }),
  ).toBeUndefined();
});
