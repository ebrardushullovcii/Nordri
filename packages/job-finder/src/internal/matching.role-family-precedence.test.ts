import { expect, test } from "vitest";
import { createSeed } from "../workspace-service.test-fixtures";
import { createMatchAssessment } from "./matching";

test("an explicit data occupation is not rescued by the shared engineer head or software keywords", () => {
  const seed = createSeed();
  const preferences = {
    ...seed.searchPreferences,
    targetRoles: [
      "Software Engineer",
      "Fullstack Engineer",
      "Backend Engineer",
    ],
    locations: [],
    workModes: [],
    companyWhitelist: [],
  };
  const posting = {
    ...seed.savedJobs[0]!,
    title: "Senior Data Engineer",
    description:
      "Build data pipelines. React TypeScript Node.js backend fullstack software platforms.",
    keySkills: ["React", "TypeScript", "Node.js"],
  };
  const assessment = createMatchAssessment(seed.profile, preferences, posting);
  expect(assessment.recommendation).toBe("skip");
  expect(assessment.dimensions.roleSuitability.state).toBe("conflict");
  expect(assessment.gaps).toContain(
    "Role family is outside the current target roles, so this is unlikely to be a useful match.",
  );

  const domainQualified = createMatchAssessment(seed.profile, preferences, {
    ...posting,
    title: "Software Engineer, Data Platform",
  });
  expect(domainQualified.dimensions.roleSuitability.state).not.toBe("conflict");
  const explicitlyWanted = createMatchAssessment(
    seed.profile,
    { ...preferences, targetRoles: ["Software Engineer", "Data Engineer"] },
    posting,
  );
  expect(explicitlyWanted.dimensions.roleSuitability.state).not.toBe(
    "conflict",
  );
});
