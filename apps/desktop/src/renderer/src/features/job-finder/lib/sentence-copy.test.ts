import { expect, it } from "vitest";
import { joinUniqueSentences } from "./sentence-copy";
it("joins fit reasons into complete sentences and omits repeated reasons", () => {
  expect(
    joinUniqueSentences([
      "Remote in the UK",
      "Relevant experience.",
      "remote in the UK.",
      "Relevant experience. Relevant experience.",
    ]),
  ).toBe("Remote in the UK. Relevant experience.");
});
