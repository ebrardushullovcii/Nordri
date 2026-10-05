// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ResumeWorkspaceLanguagePicker } from "./resume-workspace-language-picker";
afterEach(cleanup);

test("shows the detected listing language and switches to English in one choice", () => {
  const onWrite = vi.fn();
  render(
    <ResumeWorkspaceLanguagePicker
      language={null}
      writtenLanguage="German"
      disabled={false}
      onWrite={onWrite}
    />,
  );
  expect(
    screen.getByRole("option", { name: "Listing language — German" }),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Resume language"), {
    target: { value: "English" },
  });
  expect(onWrite).toHaveBeenCalledWith("English");
  expect(
    screen.getByText("Choosing a language translates this draft."),
  ).toBeTruthy();
});

test("accepts a language outside the suggested list", () => {
  const onWrite = vi.fn();
  render(
    <ResumeWorkspaceLanguagePicker
      language={null}
      writtenLanguage={null}
      disabled={false}
      onWrite={onWrite}
    />,
  );
  fireEvent.change(screen.getByLabelText("Resume language"), {
    target: { value: "custom" },
  });
  fireEvent.change(screen.getByLabelText("Another resume language"), {
    target: { value: "Swahili" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Write in this language" }),
  );
  expect(onWrite).toHaveBeenCalledWith("Swahili");
});
