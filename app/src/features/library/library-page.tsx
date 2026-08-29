import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  Input,
  ListButton,
  Plus,
  Textarea,
  Trash2,
} from "@/components/ui";
import { DiscussionMarkdown } from "@/features/discussions";
import {
  backend,
  type LibraryDocument,
  type LibraryDocumentSummary,
} from "@/lib/backend";

type EditorMode = "view" | "create" | "edit";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatLibraryTimestamp(
  timestamp: string,
  locales?: Intl.LocalesArgument,
): string {
  return new Intl.DateTimeFormat(locales, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function summary(document: LibraryDocument): LibraryDocumentSummary {
  const { content: _content, ...documentSummary } = document;
  return documentSummary;
}

function upsertSummary(
  documents: LibraryDocumentSummary[],
  document: LibraryDocument,
): LibraryDocumentSummary[] {
  const next = documents.filter((item) => item.id !== document.id);
  next.push(summary(document));
  return next.sort(
    (left, right) =>
      left.title.localeCompare(right.title, undefined, {
        sensitivity: "base",
      }) || left.id - right.id,
  );
}

export function LibraryPage() {
  const [documents, setDocuments] = useState<LibraryDocumentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [document, setDocument] = useState<LibraryDocument | null>(null);
  const [mode, setMode] = useState<EditorMode>("view");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const selectedSummary = useMemo(
    () => documents.find((item) => item.id === selectedId),
    [documents, selectedId],
  );
  const selectedRevision = selectedSummary?.revision;

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      try {
        const result = await backend.listLibraryDocuments();
        if (!active) return;
        setDocuments(result.documents);
        setListError(null);
        setSelectedId((current) =>
          current !== null &&
          result.documents.some((item) => item.id === current)
            ? current
            : (result.documents[0]?.id ?? null),
        );
        setLoadingList(false);
      } catch (loadError) {
        if (active) {
          setListError(errorMessage(loadError));
          setLoadingList(false);
        }
      } finally {
        if (active) timer = setTimeout(() => void refresh(), 1_000);
      }
    }

    void refresh();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (
      selectedId === null ||
      selectedRevision === undefined ||
      mode !== "view"
    ) {
      if (selectedId === null && mode === "view") setDocument(null);
      return;
    }
    let active = true;
    setLoadingDocument(true);
    setError(null);
    void backend
      .readLibraryDocument(selectedId)
      .then((loaded) => {
        if (active) setDocument(loaded);
      })
      .catch((loadError) => {
        if (active) {
          setDocument(null);
          setError(errorMessage(loadError));
        }
      })
      .finally(() => {
        if (active) setLoadingDocument(false);
      });
    return () => {
      active = false;
    };
  }, [mode, selectedId, selectedRevision]);

  function beginCreate() {
    setMode("create");
    setTitle("");
    setContent("");
    setError(null);
  }

  function beginEdit() {
    if (!document) return;
    setMode("edit");
    setTitle(document.title);
    setContent(document.content);
    setError(null);
  }

  function cancelEdit() {
    setMode("view");
    setTitle("");
    setContent("");
    setError(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved =
        mode === "create"
          ? await backend.createLibraryDocument(title, content)
          : document
            ? await backend.updateLibraryDocument(
                document.id,
                document.revision,
                title,
                content,
              )
            : null;
      if (!saved) return;
      setDocuments((current) => upsertSummary(current, saved));
      setSelectedId(saved.id);
      setDocument(saved);
      setMode("view");
      setTitle("");
      setContent("");
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function deleteDocument() {
    if (!document) return;
    setSaving(true);
    setError(null);
    try {
      await backend.deleteLibraryDocument(document.id, document.revision);
      const remaining = documents.filter((item) => item.id !== document.id);
      setDocuments(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setDocument(null);
      setDeleteOpen(false);
      setDeleteConfirmation("");
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="library-workspace">
      <aside className="library-list-pane" aria-label="Library documents">
        <div className="library-list-toolbar">
          <div className="library-list-heading">
            <span>Documents</span>
            <Badge size="small">{documents.length}</Badge>
          </div>
          <Button
            aria-label="New document"
            disabled={saving}
            onClick={beginCreate}
            size="icon"
            variant="primary"
          >
            <Plus aria-hidden="true" size={15} />
          </Button>
        </div>
        {loadingList ? (
          <p className="library-list-empty">Loading documents</p>
        ) : documents.length === 0 ? (
          <p
            className={
              listError
                ? "library-list-empty library-error"
                : "library-list-empty"
            }
            role={listError ? "alert" : undefined}
          >
            {listError ?? "No documents"}
          </p>
        ) : (
          <div className="library-list-items">
            {listError ? (
              <p className="library-list-refresh-error" role="alert">
                {listError}
              </p>
            ) : null}
            {documents.map((item) => (
              <ListButton
                active={mode !== "create" && item.id === selectedId}
                aria-label={`Open ${item.title}`}
                key={item.id}
                meta={`Updated ${formatLibraryTimestamp(item.updated_at)}`}
                onClick={() => {
                  setSelectedId(item.id);
                  setMode("view");
                  setError(null);
                }}
                title={item.title}
              />
            ))}
          </div>
        )}
      </aside>
      <div className="library-detail-pane">
        {mode === "create" || mode === "edit" ? (
          <form
            className="library-editor"
            onSubmit={(event) => void save(event)}
          >
            <header className="library-editor-header border-border border-b">
              <h2>{mode === "create" ? "New document" : "Edit document"}</h2>
            </header>
            <div className="library-editor-fields">
              <label htmlFor="library-document-title">
                <span>Title</span>
                <Input
                  autoComplete="off"
                  autoFocus
                  disabled={saving}
                  id="library-document-title"
                  maxLength={120}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  value={title}
                />
              </label>
              <label
                className="library-content-field"
                htmlFor="library-document-content"
              >
                <span>Content</span>
                <Textarea
                  disabled={saving}
                  id="library-document-content"
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="Write Markdown"
                  value={content}
                />
              </label>
              {error ? (
                <p className="library-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <footer className="library-editor-actions border-border border-t">
              <Button
                disabled={saving}
                onClick={cancelEdit}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                disabled={saving || !title}
                type="submit"
                variant="primary"
              >
                {saving ? "Saving" : "Save"}
              </Button>
            </footer>
          </form>
        ) : document && selectedId === document.id ? (
          <article className="library-document">
            <header className="library-document-header border-border border-b">
              <div>
                <h2>{document.title}</h2>
                <p>Updated {formatLibraryTimestamp(document.updated_at)}</p>
              </div>
              <div className="library-document-actions">
                <Button
                  disabled={saving}
                  onClick={beginEdit}
                  variant="secondary"
                >
                  Edit
                </Button>
                <Dialog
                  description={`Permanently delete ${document.title}.`}
                  onOpenChange={(open) => {
                    setDeleteOpen(open);
                    setDeleteConfirmation("");
                  }}
                  open={deleteOpen}
                  title="Delete document"
                  trigger={
                    <Button
                      aria-label={`Delete ${document.title}`}
                      disabled={saving}
                      size="icon"
                      variant="danger"
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </Button>
                  }
                  triggerTooltip="Delete"
                >
                  <div className="library-delete-confirmation">
                    <p>This document will be permanently deleted.</p>
                    <label htmlFor={`delete-library-document-${document.id}`}>
                      <span>Type {document.title} to confirm</span>
                      <Input
                        autoComplete="off"
                        autoFocus
                        disabled={saving}
                        id={`delete-library-document-${document.id}`}
                        onChange={(event) =>
                          setDeleteConfirmation(event.target.value)
                        }
                        value={deleteConfirmation}
                      />
                    </label>
                    {error ? (
                      <p className="library-error" role="alert">
                        {error}
                      </p>
                    ) : null}
                    <div className="library-delete-actions">
                      <Button
                        disabled={saving}
                        onClick={() => setDeleteOpen(false)}
                        variant="secondary"
                      >
                        Cancel
                      </Button>
                      <Button
                        disabled={
                          saving || deleteConfirmation !== document.title
                        }
                        onClick={() => void deleteDocument()}
                        variant="danger"
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </Dialog>
              </div>
            </header>
            <div className="library-document-content">
              {document.content ? (
                <DiscussionMarkdown body={document.content} references={[]} />
              ) : (
                <p className="library-document-empty">Empty document</p>
              )}
            </div>
          </article>
        ) : loadingDocument ? (
          <div className="library-empty">Loading document</div>
        ) : error || listError ? (
          <div className="library-empty library-error" role="alert">
            {error ?? listError}
          </div>
        ) : (
          <div className="library-empty">
            <div>
              <h2>
                {documents.length === 0
                  ? "Create a document"
                  : "Select a document"}
              </h2>
              {documents.length === 0 ? (
                <Button onClick={beginCreate} variant="primary">
                  New document
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
