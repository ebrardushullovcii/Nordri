import { expect, it } from "vitest";
import {
  AddBrowserJobInputSchema,
  AddBrowserJobResultSchema,
} from "./desktop-browser";
it("binds Add this job to an exact tab and returns only saved-job display facts", () => {
  expect(AddBrowserJobInputSchema.parse({ tabId: "tab-one" })).toEqual({
    tabId: "tab-one",
  });
  expect(
    AddBrowserJobInputSchema.safeParse({ tabId: "", html: "untrusted" })
      .success,
  ).toBe(false);
  expect(
    AddBrowserJobInputSchema.safeParse({
      tabId: "one",
      url: "https://other.test",
    }).success,
  ).toBe(false);
  expect(
    AddBrowserJobResultSchema.parse({
      jobId: "saved-one",
      title: "Designer",
      company: "Example Studio",
      planName: "Design",
    }).title,
  ).toBe("Designer");
});
