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
      listingLanguage="German"
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

test.each(["German", null])(
  "a chosen English resume does not label the listing English (listing %s)",
  (listingLanguage) => {
    render(
      <ResumeWorkspaceLanguagePicker
        language="English"
        writtenLanguage="English"
        listingLanguage={listingLanguage}
        disabled={false}
        onWrite={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("option", {
        name: listingLanguage
          ? "Listing language — German"
          : "Listing language",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: "Listing language — English" }),
    ).toBeNull();
  },
);

test("an older English draft does not claim to know the German listing's language", () => {
  render(
    <ResumeWorkspaceLanguagePicker
      language={null}
      writtenLanguage="English"
      disabled={false}
      onWrite={vi.fn()}
    />,
  );
  expect(screen.getByRole("option", { name: "Listing language" })).toBeTruthy();
  expect(
    screen.queryByRole("option", { name: "Listing language — English" }),
  ).toBeNull();
});

test("keeps a gap below the header and lines up with its text", () => {
  render(
    <ResumeWorkspaceLanguagePicker
      disabled={false}
      language={null}
      listingLanguage="German"
      writtenLanguage="German"
      onWrite={vi.fn()}
    />,
  );
  const row = document.querySelector("[data-resume-language-picker]");
  expect(row?.className).toContain("mt-2");
  expect(row?.className).toContain("px-5");
});
