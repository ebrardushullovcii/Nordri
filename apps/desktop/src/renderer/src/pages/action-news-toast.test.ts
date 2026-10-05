import { expect, it } from "vitest";
import { isActionNews } from "./action-news-toast";
it.each([
  "Application tracker updated.",
  "Activity resumed.",
  "Search plan created.",
  "Active search plan updated.",
])("uses a toast for %s", (message) =>
  expect(isActionNews(message)).toBe(true),
);
it.each([null, "Could not save the tracker.", "Activity could not resume."])(
  "keeps actionable errors inline",
  (message) => expect(isActionNews(message)).toBe(false),
);
