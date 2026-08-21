import { FileText, Folder, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, SegmentedControl } from "@/components/ui";
import { DiscussionMarkdown } from "@/features/discussions/discussion-markdown";
import { type AgentMemoryFile, backend } from "@/lib/backend";

const FILE_LIST_PAGE_SIZE = 100;
const FILE_CONTENT_PAGE_LINES = 200;

export type MemoryTreeNode =
  | { type: "file"; name: string; path: string }
  | {
      type: "directory";
      name: string;
      path: string;
      children: MemoryTreeNode[];
    };

type MutableDirectory = {
  type: "directory";
  name: string;
  path: string;
  children: Map<string, MutableDirectory | MemoryTreeNode>;
};

export function buildMemoryTree(paths: string[]): MemoryTreeNode[] {
  const root: MutableDirectory = {
    type: "directory",
    name: "",
    path: "",
    children: new Map(),
  };
  for (const path of paths.filter((value) => value !== "MEMORY.md")) {
    const parts = path.split("/");
    let current = root;
    for (const [index, part] of parts.entries()) {
      const currentPath = parts.slice(0, index + 1).join("/");
      if (index === parts.length - 1) {
        current.children.set(part, { type: "file", name: part, path });
        continue;
      }
      const existing = current.children.get(part);
      if (existing?.type === "directory") {
        current = existing as MutableDirectory;
      } else {
        const directory: MutableDirectory = {
          type: "directory",
          name: part,
          path: currentPath,
          children: new Map(),
        };
        current.children.set(part, directory);
        current = directory;
      }
    }
  }

  function freeze(directory: MutableDirectory): MemoryTreeNode[] {
    return [...directory.children.values()]
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === "directory" ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      })
      .map((node) =>
        node.type === "directory"
          ? {
              type: "directory",
              name: node.name,
              path: node.path,
              children: freeze(node as MutableDirectory),
            }
          : node,
      );
  }

  return freeze(root);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function MemoryTree({
  nodes,
  onSelect,
  selectedPath,
}: {
  nodes: MemoryTreeNode[];
  onSelect: (path: string) => void;
  selectedPath: string | null;
}) {
  return (
    <ul className="agent-memory-tree">
      {nodes.map((node) =>
        node.type === "directory" ? (
          <li key={node.path}>
            <details open>
              <summary>
                <Folder aria-hidden="true" size={14} />
                {node.name}
              </summary>
              <MemoryTree
                nodes={node.children}
                onSelect={onSelect}
                selectedPath={selectedPath}
              />
            </details>
          </li>
        ) : (
          <li key={node.path}>
            <button
              aria-current={selectedPath === node.path ? "page" : undefined}
              onClick={() => onSelect(node.path)}
              type="button"
            >
              <FileText aria-hidden="true" size={14} />
              <span>{node.name}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

type FileState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; file: AgentMemoryFile }
  | { status: "error"; message: string };

export type MemoryViewState = {
  selectedPath: string | null;
  lineOffset: number;
  mode: "source" | "preview";
};

export function resetMemoryView(selectedPath: string | null): MemoryViewState {
  return { selectedPath, lineOffset: 1, mode: "source" };
}

export function AgentMemoryBrowser({ agentId }: { agentId: number }) {
  const [paths, setPaths] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [listState, setListState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [listError, setListError] = useState("");
  const [view, setView] = useState<MemoryViewState>(() =>
    resetMemoryView(null),
  );
  const { selectedPath, lineOffset, mode } = view;
  const [fileState, setFileState] = useState<FileState>({ status: "idle" });
  const [refreshKey, setRefreshKey] = useState(0);

  const loadFiles = useCallback(
    async (offset = 0) => {
      if (offset === 0) {
        setListState("loading");
        setPaths([]);
        setView(resetMemoryView(null));
      }
      try {
        const page = await backend.listAgentMemory(
          agentId,
          offset,
          FILE_LIST_PAGE_SIZE,
        );
        setPaths((current) => {
          const next = offset === 0 ? page.paths : [...current, ...page.paths];
          return [...new Set(next)];
        });
        setTotal(page.total);
        setNextOffset(page.next_offset);
        setListState("ready");
        setView((current) =>
          offset === 0 || current.selectedPath === null
            ? resetMemoryView(page.paths[0] ?? null)
            : current,
        );
      } catch (error) {
        setListError(errorMessage(error));
        setListState("error");
      }
    },
    [agentId],
  );

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    void refreshKey;
    if (!selectedPath) {
      setFileState({ status: "idle" });
      return;
    }
    let active = true;
    setFileState({ status: "loading" });
    void backend
      .readAgentMemory(
        agentId,
        selectedPath,
        lineOffset,
        FILE_CONTENT_PAGE_LINES,
      )
      .then((file) => {
        if (active) {
          setFileState({ status: "ready", file });
        }
      })
      .catch((error) => {
        if (active) {
          setFileState({ status: "error", message: errorMessage(error) });
        }
      });
    return () => {
      active = false;
    };
  }, [agentId, lineOffset, refreshKey, selectedPath]);

  const tree = useMemo(() => buildMemoryTree(paths), [paths]);
  const hasMainIndex = paths.includes("MEMORY.md");

  function selectFile(path: string) {
    setView(resetMemoryView(path));
  }

  return (
    <section className="agent-memory" aria-label="Agent Memory">
      <header className="agent-section-header agent-memory__header">
        <div>
          <h3>Memory</h3>
          <p>
            Agent-private means private from other Agents. You, the local owner,
            can view it.
          </p>
        </div>
        <Button
          aria-label="Refresh Memory"
          onClick={() => void loadFiles()}
          size="compact"
          variant="quiet"
        >
          <RefreshCw aria-hidden="true" size={13} />
          Refresh
        </Button>
      </header>
      {listState === "loading" ? (
        <p className="agent-section-empty">Loading Memory</p>
      ) : listState === "error" ? (
        <div className="agent-section-empty" role="alert">
          <p>{listError}</p>
          <Button onClick={() => void loadFiles()} size="compact">
            Retry
          </Button>
        </div>
      ) : paths.length === 0 ? (
        <p className="agent-section-empty">This Agent has no Memory.</p>
      ) : (
        <>
          {!hasMainIndex ? (
            <p className="agent-memory__notice">
              Topic files exist, but this Agent has no MEMORY.md main index.
            </p>
          ) : null}
          <div className="agent-memory-browser">
            <aside aria-label="Memory files" className="agent-memory-files">
              {hasMainIndex ? (
                <button
                  aria-current={
                    selectedPath === "MEMORY.md" ? "page" : undefined
                  }
                  aria-label="Open MEMORY.md"
                  className="agent-memory-main"
                  onClick={() => selectFile("MEMORY.md")}
                  type="button"
                >
                  <FileText aria-hidden="true" size={14} />
                  <span>MEMORY.md</span>
                  <Badge size="small" tone="accent">
                    Main index
                  </Badge>
                </button>
              ) : null}
              <MemoryTree
                nodes={tree}
                onSelect={selectFile}
                selectedPath={selectedPath}
              />
              {nextOffset !== null ? (
                <Button
                  onClick={() => void loadFiles(nextOffset)}
                  size="compact"
                  variant="quiet"
                >
                  Load more files ({paths.length}/{total})
                </Button>
              ) : null}
            </aside>
            <section
              aria-label="Memory file content"
              className="agent-memory-content"
            >
              {!selectedPath || fileState.status === "idle" ? (
                <p className="agent-section-empty">Select a Memory file.</p>
              ) : fileState.status === "loading" ? (
                <p className="agent-section-empty">Loading {selectedPath}</p>
              ) : fileState.status === "error" ? (
                <div className="agent-section-empty" role="alert">
                  <p>{fileState.message}</p>
                  <Button
                    onClick={() => setRefreshKey((value) => value + 1)}
                    size="compact"
                  >
                    Retry
                  </Button>
                </div>
              ) : (
                <>
                  <header className="agent-memory-content__header">
                    <div>
                      <strong className="agent-memory-path">
                        {fileState.file.path}
                      </strong>
                      <span>
                        Lines {fileState.file.start_line}–
                        {fileState.file.end_line} of{" "}
                        {fileState.file.total_lines}
                        {fileState.file.truncated ? " · Truncated" : ""}
                      </span>
                    </div>
                    <SegmentedControl
                      aria-label="Memory view"
                      onValueChange={(value) =>
                        setView((current) => ({ ...current, mode: value }))
                      }
                      options={[
                        { label: "Source", value: "source" },
                        { label: "Preview", value: "preview" },
                      ]}
                      value={mode}
                    />
                  </header>
                  {fileState.file.bytes_truncated ? (
                    <p className="agent-memory__notice">
                      This page reached the safe {fileState.file.max_bytes}-byte
                      response limit.
                    </p>
                  ) : null}
                  <div className="agent-memory-document">
                    {mode === "source" ? (
                      <pre>{fileState.file.content}</pre>
                    ) : (
                      <DiscussionMarkdown
                        body={fileState.file.content}
                        references={[]}
                      />
                    )}
                  </div>
                  <footer className="agent-memory-pagination">
                    <Button
                      disabled={lineOffset === 1}
                      onClick={() =>
                        setView((current) => ({
                          ...current,
                          lineOffset: Math.max(
                            1,
                            current.lineOffset - FILE_CONTENT_PAGE_LINES,
                          ),
                        }))
                      }
                      size="compact"
                      variant="quiet"
                    >
                      Previous
                    </Button>
                    <Button
                      onClick={() => setRefreshKey((value) => value + 1)}
                      size="compact"
                      variant="quiet"
                    >
                      Refresh
                    </Button>
                    <Button
                      disabled={
                        fileState.file.bytes_truncated ||
                        fileState.file.end_line >= fileState.file.total_lines
                      }
                      onClick={() =>
                        setView((current) => ({
                          ...current,
                          lineOffset: fileState.file.end_line + 1,
                        }))
                      }
                      size="compact"
                      variant="quiet"
                    >
                      Next
                    </Button>
                  </footer>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
