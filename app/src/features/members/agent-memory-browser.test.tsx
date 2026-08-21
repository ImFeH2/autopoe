import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AgentMemoryBrowser,
  buildMemoryTree,
  resetMemoryView,
} from "./agent-memory-browser";

describe("AgentMemoryBrowser", () => {
  it("builds directories while leaving MEMORY.md outside the topic tree", () => {
    expect(
      buildMemoryTree([
        "MEMORY.md",
        "topics/release.md",
        "topics/nested/notes.md",
        "root.md",
      ]),
    ).toEqual([
      {
        type: "directory",
        name: "topics",
        path: "topics",
        children: [
          {
            type: "directory",
            name: "nested",
            path: "topics/nested",
            children: [
              {
                type: "file",
                name: "notes.md",
                path: "topics/nested/notes.md",
              },
            ],
          },
          {
            type: "file",
            name: "release.md",
            path: "topics/release.md",
          },
        ],
      },
      { type: "file", name: "root.md", path: "root.md" },
    ]);
  });

  it("resets a paged preview to the refreshed first file source page", () => {
    const pagedPreview = {
      selectedPath: "topics/long.md",
      lineOffset: 201,
      mode: "preview" as const,
    };

    expect(pagedPreview.lineOffset).toBe(201);
    expect(resetMemoryView("MEMORY.md")).toEqual({
      selectedPath: "MEMORY.md",
      lineOffset: 1,
      mode: "source",
    });
    expect(resetMemoryView("topics/other.md")).toEqual({
      selectedPath: "topics/other.md",
      lineOffset: 1,
      mode: "source",
    });
  });

  it("starts in a private on-demand loading state", () => {
    const markup = renderToStaticMarkup(<AgentMemoryBrowser agentId={2} />);

    expect(markup).toContain('aria-label="Agent Memory"');
    expect(markup).toContain("private from other Agents");
    expect(markup).toContain("local owner");
    expect(markup).toContain("Loading Memory");
  });
});
