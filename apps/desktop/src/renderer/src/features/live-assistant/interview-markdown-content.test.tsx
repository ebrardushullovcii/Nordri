// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import {
  InterviewMarkdownContent,
  parseInterviewMarkdownBlocks,
} from "./interview-markdown-content";

afterEach(() => {
  cleanup();
});

describe("parseInterviewMarkdownBlocks", () => {
  test("splits headings, lists, and paragraphs", () => {
    expect(
      parseInterviewMarkdownBlocks(
        "## Situation\n\nFirst paragraph line one.\ncontinues here.\n\n- alpha\n- beta\n\n1. one\n2. two",
      ),
    ).toEqual([
      { type: "heading", level: 2, text: "Situation" },
      { type: "paragraph", text: "First paragraph line one.\ncontinues here." },
      { type: "unordered-list", items: ["alpha", "beta"] },
      { type: "ordered-list", items: ["one", "two"] },
    ]);
  });

  test("keeps plain prose as a single paragraph", () => {
    expect(parseInterviewMarkdownBlocks("Just a plain answer.")).toEqual([
      { type: "paragraph", text: "Just a plain answer." },
    ]);
    expect(parseInterviewMarkdownBlocks("")).toEqual([]);
  });
});

describe("InterviewMarkdownContent rendering", () => {
  test("formats bold, italic, headings, and lists", () => {
    const rendered = render(
      <InterviewMarkdownContent
        content={
          "# Headline\n\nUse **bold** and *italic* moves.\n\n- First\n- Second"
        }
      />,
    );

    const root = rendered.container.querySelector("[data-interview-markdown]");
    expect(root).not.toBeNull();
    expect(root?.querySelector("h4")?.textContent).toBe("Headline");
    expect(root?.querySelector("strong")?.textContent).toBe("bold");
    expect(root?.querySelector("em")?.textContent).toBe("italic");
    expect(root?.querySelectorAll("ul li")).toHaveLength(2);
    expect(root?.querySelector("ul li")?.textContent).toBe("First");
    expect(root?.textContent).not.toContain("**");
  });

  test("renders ordered lists and deeper headings", () => {
    const rendered = render(
      <InterviewMarkdownContent
        content={"### Details\n\n1. Open with context\n2. Close with result"}
      />,
    );

    const root = rendered.container.querySelector("[data-interview-markdown]");
    expect(root?.querySelector("h5")?.textContent).toBe("Details");
    const items = [...(root?.querySelectorAll("ol li") ?? [])];
    expect(items.map((item) => item.textContent)).toEqual([
      "Open with context",
      "Close with result",
    ]);
  });

  test("escapes raw HTML instead of injecting it", () => {
    const rendered = render(
      <InterviewMarkdownContent
        content={
          '## Summary\n\nSafe **answer** <img src=x onerror="alert(1)"> <script>alert(2)</script>'
        }
      />,
    );

    const root = rendered.container.querySelector("[data-interview-markdown]");
    expect(root).not.toBeNull();
    expect(root?.querySelector("img")).toBeNull();
    expect(root?.querySelector("script")).toBeNull();
    expect(root?.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(root?.textContent).toContain("<script>alert(2)</script>");
    expect(root?.querySelector("strong")?.textContent).toBe("answer");
  });
});
