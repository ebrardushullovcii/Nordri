// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ResumeWorkspaceLanguagePicker } from "./resume-workspace-language-picker";
afterEach(cleanup);
test("keeps the requested language while a failed rewrite returns the previous draft", () => {
  const props = {
    language: "English",
    writtenLanguage: "English",
    disabled: false,
    onWrite: vi.fn(),
  };
  const view = render(<ResumeWorkspaceLanguagePicker {...props} />);
  fireEvent.change(screen.getByLabelText("Resume language"), {
    target: { value: "German" },
  });
  view.rerender(<ResumeWorkspaceLanguagePicker {...props} disabled />);
  view.rerender(<ResumeWorkspaceLanguagePicker {...props} />);
  expect(
    screen.getByLabelText<HTMLSelectElement>("Resume language").value,
  ).toBe("German");
  view.rerender(
    <ResumeWorkspaceLanguagePicker
      {...props}
      language="German"
      writtenLanguage="German"
    />,
  );
  expect(
    screen.getByLabelText<HTMLSelectElement>("Resume language").value,
  ).toBe("German");
});
