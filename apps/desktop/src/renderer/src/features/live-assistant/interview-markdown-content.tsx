import { Fragment, type ReactNode } from "react";

interface InterviewMarkdownHeading {
  type: "heading";
  level: number;
  text: string;
}

interface InterviewMarkdownUnorderedList {
  type: "unordered-list";
  items: string[];
}

interface InterviewMarkdownOrderedList {
  type: "ordered-list";
  items: string[];
}

interface InterviewMarkdownParagraph {
  type: "paragraph";
  text: string;
}

type InterviewMarkdownBlock =
  | InterviewMarkdownHeading
  | InterviewMarkdownUnorderedList
  | InterviewMarkdownOrderedList
  | InterviewMarkdownParagraph;

const headingLinePattern = /^(#{1,6})\s+(.+)$/;
const unorderedListItemPattern = /^\s*[-*+]\s+(.+)$/;
const orderedListItemPattern = /^\s*\d+[.)]\s+(.+)$/;

export function parseInterviewMarkdownBlocks(
  source: string,
): InterviewMarkdownBlock[] {
  const blocks: InterviewMarkdownBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let listType: "unordered-list" | "ordered-list" | null = null;

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push({ text: paragraphLines.join("\n"), type: "paragraph" });
      paragraphLines = [];
    }
  };

  const flushList = () => {
    if (listType !== null && listItems.length > 0) {
      blocks.push(
        listType === "ordered-list"
          ? { items: listItems, type: "ordered-list" }
          : { items: listItems, type: "unordered-list" },
      );
    }
    listItems = [];
    listType = null;
  };

  for (const line of source.split("\n")) {
    const headingMatch = headingLinePattern.exec(line);
    const unorderedMatch = unorderedListItemPattern.exec(line);
    const orderedMatch = orderedListItemPattern.exec(line);

    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        level: headingMatch[1]?.length ?? 1,
        text: headingMatch[2] ?? "",
        type: "heading",
      });
      continue;
    }

    if (unorderedMatch || orderedMatch) {
      flushParagraph();
      const nextListType = unorderedMatch ? "unordered-list" : "ordered-list";
      if (listType !== null && listType !== nextListType) {
        flushList();
      }
      listType = nextListType;
      listItems.push(unorderedMatch?.[1] ?? orderedMatch?.[1] ?? "");
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

const inlineTokenPatterns = [
  { regex: /^\*\*([^*\n]+)\*\*/ },
  { regex: /^__([^_\n]+)__/ },
  { regex: /^\*([^*\n]+)\*/ },
  { regex: /^_([^_\n]+)_/ },
] as const;

function findNextMarkerIndex(value: string): number {
  let closestIndex = -1;
  for (const marker of ["*", "_"]) {
    const index = value.indexOf(marker);
    if (index !== -1 && (closestIndex === -1 || index < closestIndex)) {
      closestIndex = index;
    }
  }
  return closestIndex;
}

function renderInlineMarkdown(content: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = content;
  let nodeIndex = 0;

  while (remaining.length > 0) {
    const token = inlineTokenPatterns.find(({ regex }) =>
      regex.test(remaining),
    );
    const match = token?.regex.exec(remaining);

    if (token && match) {
      const key = `${keyPrefix}_${nodeIndex}`;
      const children = renderInlineMarkdown(match[1] ?? "", key);
      nodes.push(
        token === inlineTokenPatterns[0] || token === inlineTokenPatterns[1] ? (
          <strong key={key}>{children}</strong>
        ) : (
          <em key={key}>{children}</em>
        ),
      );
      remaining = remaining.slice(match[0].length);
      nodeIndex += 1;
      continue;
    }

    const nextMarkerIndex = findNextMarkerIndex(remaining);
    const takeCount =
      nextMarkerIndex === -1 ? remaining.length : Math.max(nextMarkerIndex, 1);
    nodes.push(
      <Fragment key={`${keyPrefix}_text_${nodeIndex}`}>
        {remaining.slice(0, takeCount)}
      </Fragment>,
    );
    remaining = remaining.slice(takeCount);
    nodeIndex += 1;
  }

  return nodes;
}

function renderMarkdownInlineText(
  text: string,
  keyPrefix: string,
): ReactNode[] {
  return renderInlineMarkdown(text.replace(/\r/g, ""), keyPrefix);
}

export function InterviewMarkdownContent(props: { content: string }) {
  const blocks = parseInterviewMarkdownBlocks(props.content);

  return (
    <div className="grid gap-1.5 break-words" data-interview-markdown="">
      {blocks.map((block, index) => {
        const key = `block_${index}`;

        if (block.type === "heading") {
          return block.level <= 2 ? (
            <h4 className="text-[1.08em] font-bold leading-snug" key={key}>
              {renderMarkdownInlineText(block.text, key)}
            </h4>
          ) : (
            <h5 className="text-[1em] font-semibold leading-snug" key={key}>
              {renderMarkdownInlineText(block.text, key)}
            </h5>
          );
        }

        if (block.type === "unordered-list" || block.type === "ordered-list") {
          const ListTag =
            block.type === "ordered-list" ? ("ol" as const) : ("ul" as const);
          return (
            <ListTag
              className={`ml-4 grid gap-0.5 ${
                block.type === "ordered-list" ? "list-decimal" : "list-disc"
              }`}
              key={key}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`${key}_${itemIndex}`}>
                  {renderMarkdownInlineText(item, `${key}_${itemIndex}`)}
                </li>
              ))}
            </ListTag>
          );
        }

        return (
          <p className="whitespace-pre-wrap" key={key}>
            {renderMarkdownInlineText(block.text, key)}
          </p>
        );
      })}
    </div>
  );
}
