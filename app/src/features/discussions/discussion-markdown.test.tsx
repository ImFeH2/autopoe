import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  areDiscussionMarkdownPropsEqual,
  DiscussionMarkdown,
  safeDiscussionLink,
} from "./discussion-markdown";

function render(
  body: string,
  references: Parameters<typeof DiscussionMarkdown>[0]["references"] = [],
) {
  return renderToStaticMarkup(
    <DiscussionMarkdown body={body} references={references} />,
  );
}

describe("DiscussionMarkdown", () => {
  it("renders the supported CommonMark and GFM elements", () => {
    const tick = String.fromCharCode(96);
    const fence = tick.repeat(3);
    const body = [
      "# Heading",
      "",
      `**Bold** *italic* ~~removed~~ and ${tick}inline${tick}`,
      "",
      "- item",
      "  - nested",
      "",
      "> quote",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "- [x] done",
      "- [ ] open",
      "",
      `${fence}ts`,
      "const value = 1;",
      fence,
    ].join("\n");
    const markup = render(body);

    expect(markup).toContain("<h1>Heading</h1>");
    expect(markup).toContain("<strong>Bold</strong>");
    expect(markup).toContain("<em>italic</em>");
    expect(markup).toContain("<del>removed</del>");
    expect(markup).toContain("<blockquote>");
    expect(markup).toContain("message-markdown-table-scroll");
    expect(markup).toContain("<table");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('<code class="language-ts">');
  });

  it("renders list DOM with scoped unordered and ordered marker styles", () => {
    const markup = render(
      [
        "- first item",
        "- second item",
        "",
        "1. first item",
        "2. second item",
      ].join("\n"),
    );
    const styles = readFileSync(
      new URL("./discussions.css", import.meta.url),
      "utf8",
    );

    expect(markup).toContain(
      "<ul>\n<li>first item</li>\n<li>second item</li>\n</ul>",
    );
    expect(markup).toContain(
      "<ol>\n<li>first item</li>\n<li>second item</li>\n</ol>",
    );
    expect(styles).toMatch(
      /\.message-markdown ul\s*\{\s*list-style-type:\s*disc;\s*\}/u,
    );
    expect(styles).toMatch(
      /\.message-markdown ol\s*\{\s*list-style-type:\s*decimal;\s*\}/u,
    );
    expect(styles).toMatch(
      /\.message-markdown ul,\s*\.message-markdown ol\s*\{\s*padding-left:\s*22px;\s*\}/u,
    );
  });

  it("preserves chat line breaks including CRLF while keeping paragraphs", () => {
    const markup = render("first\r\nsecond\nthird\n\nnext paragraph");

    expect(markup).toContain("first<br/>\nsecond<br/>\nthird");
    expect(markup).toContain("<p>next paragraph</p>");
  });

  it("drops raw HTML and only makes absolute HTTP links clickable", () => {
    const body = [
      '<script>alert("x")</script>',
      '<img src=x onerror="alert(1)">',
      "[safe](https://example.com/path)",
      "[http](HTTP://example.com)",
      "[script](javascript:alert(1))",
      "[data](data:text/html,hello)",
      "[file](file:///tmp/a)",
      "[mail](mailto:user@example.com)",
      "[relative](/local)",
      "[fragment](#local)",
      "[protocol-relative](//example.com)",
      "[c1](https://example.com/a\u0085b)",
      "[zero-width](https://example.com/a\u200Bb)",
      "[bidi](https://example.com/a\u202Eb)",
    ].join("\n\n");
    const markup = render(body);

    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("<img");
    expect(markup).toContain('href="https://example.com/path"');
    expect(markup).toContain('href="http://example.com/"');
    expect(markup.match(/href=/gu)).toHaveLength(2);
    expect(markup).toContain(">script<");
    expect(markup).toContain(">relative<");
    expect(markup).toContain(">c1<");
    expect(markup).toContain(">zero-width<");
    expect(markup).toContain(">bidi<");
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it("never loads images and labels omitted alt text", () => {
    const markup = render(
      "![claimed screenshot](https://tracker.example/pixel.png) ![](data:image/png;base64,AAAA)",
    );

    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("tracker.example");
    expect(markup).toContain("[Image omitted: claimed screenshot]");
    expect(markup).toContain("[Image omitted]");
  });

  it("does not expose footnote navigation in the first release", () => {
    const markup = render("A note[^1]\n\n[^1]: hidden footnote");

    expect(markup).not.toContain("data-footnote");
    expect(markup).not.toContain("footnotes");
    expect(markup).not.toContain("hidden footnote");
  });

  it("uses a fail-closed absolute HTTP URL policy", () => {
    expect(safeDiscussionLink("https://example.com/a")).toBe(
      "https://example.com/a",
    );
    expect(safeDiscussionLink("HTTP://example.com")).toBe(
      "http://example.com/",
    );
    expect(safeDiscussionLink(" https://example.com")).toBeNull();
    expect(safeDiscussionLink("https://exa\tmple.com")).toBeNull();
    expect(safeDiscussionLink("https://example.com/a\u0085b")).toBeNull();
    expect(safeDiscussionLink("https://example.com/a\u200Bb")).toBeNull();
    expect(safeDiscussionLink("https://example.com/a\u202Eb")).toBeNull();
    expect(safeDiscussionLink("https://example.com/a%C2%85b")).toBeNull();
    expect(safeDiscussionLink("https://example.com/a%E2%80%8Bb")).toBeNull();
    expect(safeDiscussionLink("https://example.com/a%E2%80%AEb")).toBeNull();
    expect(
      safeDiscussionLink("https://example.com\njavascript:alert(1)"),
    ).toBeNull();
    expect(safeDiscussionLink("javascript:alert(1)")).toBeNull();
    expect(safeDiscussionLink("mailto:user@example.com")).toBeNull();
    expect(safeDiscussionLink("/relative")).toBeNull();
    expect(safeDiscussionLink("//example.com")).toBeNull();
  });

  it("highlights positioned references inside one Markdown parse with astral offsets", () => {
    const body = "😀 **ask @Ada now**";
    const markup = render(body, [
      {
        member_id: 2,
        name: "Ada",
        start: 8,
        end: 12,
        in_discussion: true,
        notified: true,
        deleted: false,
      },
    ]);

    expect(markup).toContain("<strong>ask <mark");
    expect(markup).toContain("mention-reference--notified");
    expect(markup).toContain(">@Ada</mark> now</strong>");
  });

  it("does not fabricate a range for fallback or unsafe AST mappings", () => {
    const fallback = render("@Ada", [
      {
        member_id: 2,
        name: "Ada",
        start: null,
        end: null,
        in_discussion: true,
        notified: true,
        deleted: true,
      },
    ]);
    const escaped = render("\\@Ada", [
      {
        member_id: 2,
        name: "Ada",
        start: 1,
        end: 5,
        in_discussion: true,
        notified: true,
        deleted: false,
      },
    ]);

    expect(fallback).not.toContain("mention-reference");
    expect(escaped).not.toContain("mention-reference");
  });

  it("memoizes sent message parsing by stable body content", () => {
    expect(
      areDiscussionMarkdownPropsEqual(
        { body: "same", references: [] },
        { body: "same", references: [] },
      ),
    ).toBe(true);
    expect(
      areDiscussionMarkdownPropsEqual(
        { body: "before", references: [] },
        { body: "after", references: [] },
      ),
    ).toBe(false);
  });
});
