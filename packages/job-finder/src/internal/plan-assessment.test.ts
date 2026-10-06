import { expect, it } from "vitest";
import { createSeed } from "../workspace-service.test-fixtures";
import {
  personPickedJob,
  readPlanAssessment,
  withPlanAssessment,
} from "./plan-assessment";
it("stores each plan's verdict independently and shows the selected plan's score", () => {
  const job = createSeed().savedJobs[0]!;
  const a = { ...job.matchAssessment, score: 90 };
  const b = { ...job.matchAssessment, score: 20 };
  const shared = withPlanAssessment(
    withPlanAssessment(job, "design", a),
    "engineering",
    b,
  );
  expect(readPlanAssessment(shared, "design").matchAssessment.score).toBe(90);
  expect(readPlanAssessment(shared, "engineering").matchAssessment.score).toBe(
    20,
  );
  expect(
    personPickedJob({ ...job, status: "discovered", personSupplied: true }),
  ).toBe(true);
  expect(personPickedJob({ ...job, status: "shortlisted" })).toBe(true);
  expect(
    personPickedJob({
      ...job,
      status: "discovered",
      provenance: [{ ...job.provenance[0]!, targetId: "assistant_page" }],
    }),
  ).toBe(true);
});

it("prioritizes a person-supplied job even after its source has been named", () => {
  const job = createSeed().savedJobs[0]!;
  expect(
    personPickedJob({
      ...job,
      status: "discovered",
      personSupplied: true,
      provenance: [],
    }),
  ).toBe(true);
});
