import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Main,
  Panel,
  Rail,
  Row,
  type Section,
  Shell,
} from "./components/layout";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Input,
  StateDot,
  Textarea,
} from "./components/ui";
import {
  completeMention,
  formatTime,
  highlightMentions,
  matchMembers,
  mentionQuery,
} from "./features/mentions";
import "./features/features.css";
import {
  type AgentDetail,
  backend,
  type DiscussionDetail,
  type DiscussionSummary,
  type FoundMessage,
  type LibraryEntry,
  type Member,
} from "./lib/backend";

function useOrganization() {
  const [members, setMembers] = useState<Member[]>([]);
  const refresh = useCallback(async () => {
    const organization = await backend.organization();
    setMembers(organization.members);
  }, []);
  return { members, refresh };
}

function DiscussionsView({ members }: { members: Member[] }) {
  const [list, setList] = useState<DiscussionSummary[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<DiscussionDetail | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FoundMessage[] | null>(null);
  const [caret, setCaret] = useState(0);
  const [highlighted, setHighlighted] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  const loadList = useCallback(async () => {
    const found = await backend.discussions();
    setList(found);
    setSelected((current) => current ?? found[0]?.id ?? null);
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    setDetail(await backend.readDiscussion(id));
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selected !== null) void loadDetail(selected);
  }, [selected, loadDetail]);

  useEffect(() => {
    return backend.onEvent((event) => {
      if (event.type === "message.created" || event.type === "mention.acked") {
        void loadList();
        if (selected !== null) void loadDetail(selected);
      }
    });
  }, [selected, loadList, loadDetail]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when messages change
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [detail]);

  const submit = async () => {
    if (!body.trim() || selected === null) return;
    setBusy(true);
    setError(null);
    try {
      await backend.send(selected, body);
      setBody("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const search = async (text: string) => {
    setQuery(text);
    if (!text.trim()) {
      setFound(null);
      return;
    }
    setFound(await backend.searchMessages(text.trim()));
  };

  const openResult = async (result: FoundMessage) => {
    setSelected(result.discussion_id);
    setQuery("");
    setFound(null);
  };

  const mention = mentionQuery(body, caret);
  const inDiscussion = useMemo(() => {
    const allowed = new Set((detail?.members ?? []).map((item) => item.id));
    return members.filter((item) => allowed.has(item.id));
  }, [members, detail]);
  const candidates = mention ? matchMembers(inDiscussion, mention.query) : [];
  const suggesting = mention !== null && candidates.length > 0 && !dismissed;

  const accept = (member: Member) => {
    if (!mention) return;
    const next = completeMention(body, mention, caret, member.name);
    setBody(next.text);
    setCaret(next.caret);
    setHighlighted(0);
    requestAnimationFrame(() => {
      composer.current?.focus();
      composer.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const awaiting = new Set(detail?.awaiting_ack ?? []);

  const confirm = async (messageId: number, undo: boolean) => {
    if (selected === null) return;
    await (undo
      ? backend.revokeAck(selected, [messageId])
      : backend.ack(selected, [messageId]));
    await loadDetail(selected);
    await loadList();
  };

  return (
    <>
      <Panel title="Discussions">
        <div className="panel-search">
          <Input
            value={query}
            placeholder="Search messages"
            onChange={(event) => void search(event.target.value)}
          />
        </div>
        {found !== null ? (
          found.length === 0 ? (
            <EmptyState
              title="No matches"
              description={`Nothing for “${query}”.`}
            />
          ) : (
            found.map((result) => (
              <Row
                key={`${result.discussion_id}-${result.id}`}
                title={result.body}
                meta={result.sender_name}
                onClick={() => void openResult(result)}
              />
            ))
          )
        ) : list.length === 0 ? (
          <EmptyState
            title="No discussions yet"
            description="Create one to get started."
          />
        ) : (
          list.map((item) => (
            <Row
              key={item.id}
              title={item.topic}
              meta={`${item.member_ids.length} members`}
              selected={item.id === selected}
              onClick={() => setSelected(item.id)}
              trailing={
                item.unread > 0 ? (
                  <Badge tone="unread">{item.unread}</Badge>
                ) : undefined
              }
            />
          ))
        )}
      </Panel>
      <Main
        title={detail?.topic ?? "Select a discussion"}
        subtitle={detail ? `${detail.total_messages} messages` : undefined}
        banner={error}
      >
        {detail ? (
          <>
            <div className="messages">
              {detail.messages.map((message, index) => (
                <Fragment key={message.id}>
                  {index > 0 &&
                  detail.messages[index - 1].id <= detail.read_through &&
                  message.id > detail.read_through ? (
                    <div className="unread-divider">New</div>
                  ) : null}
                  <article
                    key={message.id}
                    className="message"
                    data-mentions-you={awaiting.has(message.id)}
                  >
                    <Avatar name={message.sender_name} />
                    <div className="message-body">
                      <div className="message-head">
                        <span className="message-sender">
                          {message.sender_name}
                        </span>
                        <span className="message-time">
                          {formatTime(message.created_at)}
                        </span>
                      </div>
                      <div className="message-text">
                        {highlightMentions(message.body, members)}
                      </div>
                      {awaiting.has(message.id) ? (
                        <div className="message-actions">
                          <Badge tone="pending">Waiting for you</Badge>
                          <Button
                            size="sm"
                            onClick={() => confirm(message.id, false)}
                          >
                            Mark handled
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                </Fragment>
              ))}
              <div ref={bottom} />
            </div>
            <div className="composer">
              {suggesting ? (
                <ul className="mention-menu">
                  {candidates.slice(0, 6).map((member, index) => (
                    <li key={member.id}>
                      <button
                        type="button"
                        data-active={index === highlighted % candidates.length}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          accept(member);
                        }}
                      >
                        <Avatar name={member.name} />
                        <span>{member.name}</span>
                        <span className="row-meta">
                          {member.type === "human" ? "Human" : member.state}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Textarea
                ref={composer}
                value={body}
                placeholder="Write a message. Use @Name to notify a Member."
                onChange={(event) => {
                  setBody(event.target.value);
                  setCaret(event.target.selectionStart ?? 0);
                  setHighlighted(0);
                  setDismissed(false);
                }}
                onSelect={(event) =>
                  setCaret(event.currentTarget.selectionStart ?? 0)
                }
                onKeyDown={(event) => {
                  if (suggesting) {
                    const size = candidates.length;
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setHighlighted((current) => (current + 1) % size);
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setHighlighted((current) => (current - 1 + size) % size);
                      return;
                    }
                    if (event.key === "Tab" || event.key === "Enter") {
                      if (
                        event.key === "Enter" &&
                        (event.metaKey || event.ctrlKey)
                      ) {
                        // fall through to send
                      } else {
                        event.preventDefault();
                        accept(candidates[highlighted % size]);
                        return;
                      }
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setDismissed(true);
                      return;
                    }
                  }
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey)
                  ) {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
              <div className="composer-actions">
                <span className="composer-hint">⌘/Ctrl + Enter to send</span>
                <Button
                  variant="primary"
                  disabled={busy || !body.trim()}
                  onClick={submit}
                >
                  Send
                </Button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title="Nothing selected"
            description="Pick a discussion on the left."
          />
        )}
      </Main>
    </>
  );
}

function MembersView({
  members,
  refresh,
}: {
  members: Member[];
  refresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [name, setName] = useState("");

  const agents = useMemo(
    () => members.filter((item) => item.type === "agent"),
    [members],
  );

  useEffect(() => {
    if (selected === null) return;
    void backend.agentDetail(selected).then(setDetail);
  }, [selected]);

  const create = async () => {
    if (!name.trim()) return;
    await backend.createAgent(name);
    setName("");
    await refresh();
  };

  const current = members.find((item) => item.id === selected);

  return (
    <>
      <Panel title="Members">
        {members.map((item) => (
          <Row
            key={item.id}
            title={item.name}
            meta={
              item.type === "human"
                ? "Human"
                : item.tokens
                  ? `${item.state} · ${item.tokens.toLocaleString()} tokens`
                  : item.state
            }
            leading={<Avatar name={item.name} />}
            trailing={
              item.type === "agent" ? (
                <StateDot state={item.state} />
              ) : undefined
            }
            selected={item.id === selected}
            onClick={() => setSelected(item.id)}
          />
        ))}
        <div className="composer">
          <Input
            value={name}
            placeholder="New Agent name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void create()}
          />
          <Button onClick={create} disabled={!name.trim()}>
            Create Agent
          </Button>
        </div>
      </Panel>
      <Main
        title={current?.name ?? "Select a member"}
        subtitle={
          current?.type === "agent"
            ? `${agents.length} agents in this organization`
            : undefined
        }
        actions={
          current?.type === "agent" ? (
            <Button
              size="sm"
              onClick={async () => {
                await (current.state === "paused"
                  ? backend.resumeAgent(current.id)
                  : backend.pauseAgent(current.id));
                await refresh();
              }}
            >
              {current.state === "paused" ? "Resume" : "Pause"}
            </Button>
          ) : undefined
        }
      >
        {detail && current?.type === "agent" ? (
          <div className="detail">
            <section>
              <h3>Todos</h3>
              <ul className="detail-list">
                {detail.todos.length === 0 ? (
                  <li className="row-meta">None</li>
                ) : (
                  detail.todos.map((todo) => (
                    <li key={todo.id} className="detail-item">
                      <span>{todo.title}</span>
                      <Badge
                        tone={
                          todo.status === "in_progress" ? "pending" : "default"
                        }
                      >
                        {todo.status}
                      </Badge>
                    </li>
                  ))
                )}
              </ul>
            </section>
            <section>
              <h3>Memory</h3>
              <ul className="detail-list">
                {detail.memory.length === 0 ? (
                  <li className="row-meta">None</li>
                ) : (
                  detail.memory.map((file) => (
                    <li key={file.path} className="detail-item">
                      <span className="mono">{file.path}</span>
                      <span className="row-meta">{file.size} B</span>
                    </li>
                  ))
                )}
              </ul>
            </section>
            <section>
              <h3>Spend</h3>
              <ul className="detail-list">
                <li className="detail-item">
                  <span>Tokens used</span>
                  <span className="row-meta">
                    {detail.usage.total_tokens.toLocaleString()}
                    {detail.token_limit > 0
                      ? ` of ${detail.token_limit.toLocaleString()}`
                      : ""}
                  </span>
                </li>
                <li className="detail-item">
                  <span>Model requests</span>
                  <span className="row-meta">{detail.usage.requests}</span>
                </li>
                {detail.over_token_limit ? (
                  <li className="detail-item">
                    <Badge tone="pending">
                      Limit reached, no longer scheduled
                    </Badge>
                  </li>
                ) : null}
              </ul>
            </section>
            <section>
              <h3>Recent turns</h3>
              {detail.idle_streak >= 3 ? (
                <p className="row-meta">
                  The last {detail.idle_streak} turns acknowledged work without
                  sending, editing or running anything.
                </p>
              ) : null}
              <ul className="detail-list">
                {detail.runs.slice(0, 10).map((run) => (
                  <li key={run.sequence} className="detail-turn">
                    <div className="detail-item">
                      <span className="mono">#{run.sequence}</span>
                      <span className="row-meta">
                        {formatTime(run.started_at)}
                      </span>
                      <Badge
                        tone={
                          run.status === "completed" ? "default" : "pending"
                        }
                      >
                        {run.status}
                      </Badge>
                    </div>
                    {run.effects.length === 0 ? (
                      <span className="row-meta">Produced nothing</span>
                    ) : (
                      <ul className="detail-effects">
                        {run.effects.map((effect) => (
                          <li key={`${run.sequence}-${effect.ordinal}`}>
                            <span className="mono">{effect.tool}</span>
                            <span className="row-meta">{effect.summary}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {run.error ? (
                      <span className="row-meta">{run.error}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : (
          <EmptyState
            title="No member selected"
            description="Pick someone on the left."
          />
        )}
      </Main>
    </>
  );
}

function LibraryView() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState("");
  const [hash, setHash] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setEntries(await backend.library());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!selected) return;
    void backend.readLibrary(selected).then((doc) => {
      setContent(doc.content);
      setLoaded(doc.content);
      setHash(doc.hash);
    });
  }, [selected]);

  const dirty = selected !== null && content !== loaded;

  const save = async () => {
    if (selected === null) return;
    setStatus(null);
    const result = await backend.writeLibrary(selected, content, hash);
    if (result.conflict) {
      setStatus("Someone else changed this document. Reopen it to see theirs.");
      return;
    }
    setHash(result.hash);
    setLoaded(content);
    setStatus("Saved");
    await reload();
  };

  const create = async () => {
    const path = draft.trim();
    if (!path) return;
    await backend.writeLibrary(path, "");
    setDraft("");
    await reload();
    setSelected(path);
  };

  const rename = async () => {
    if (selected === null) return;
    const destination = window.prompt("New path", selected);
    if (!destination || destination === selected) return;
    const moved = await backend.moveLibrary(selected, destination);
    await reload();
    setSelected(moved.path);
  };

  const remove = async () => {
    if (selected === null) return;
    if (!window.confirm(`Delete ${selected}?`)) return;
    await backend.deleteLibrary(selected);
    setSelected(null);
    setContent("");
    setLoaded("");
    await reload();
  };

  return (
    <>
      <Panel title="Library">
        {entries.length === 0 ? (
          <EmptyState title="Library is empty" />
        ) : (
          entries.map((entry) => (
            <Row
              key={entry.path}
              title={entry.path}
              meta={`${entry.size} B`}
              selected={entry.path === selected}
              onClick={() => setSelected(entry.path)}
            />
          ))
        )}
        <div className="composer">
          <Input
            value={draft}
            placeholder="New document path"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void create()}
          />
          <Button onClick={create} disabled={!draft.trim()}>
            Create document
          </Button>
        </div>
      </Panel>
      <Main
        title={selected ?? "Select a document"}
        banner={status}
        actions={
          selected ? (
            <>
              <Button size="sm" onClick={rename}>
                Rename
              </Button>
              <Button size="sm" variant="danger" onClick={remove}>
                Delete
              </Button>
            </>
          ) : undefined
        }
      >
        {selected ? (
          <>
            <div className="messages">
              <Textarea
                className="library-editor"
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
            </div>
            <div className="composer">
              <div className="composer-actions">
                <span className="composer-hint">
                  Agents share this document.
                </span>
                <Button variant="primary" onClick={save} disabled={!dirty}>
                  Save
                </Button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title="Nothing selected"
            description="Shared documents live here."
          />
        )}
      </Main>
    </>
  );
}

function SettingsView() {
  const [model, setModel] = useState<Record<string, unknown>>({});
  const [directories, setDirectories] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [tokenLimit, setTokenLimit] = useState("0");
  const [status, setStatus] = useState<string | null>(null);
  const [unusable, setUnusable] = useState<{ path: string; reason: string }[]>(
    [],
  );

  const load = useCallback(async () => {
    setModel(await backend.settings("model"));
    const execution = await backend.settings("execution");
    setDirectories((execution.write_directories as string[]) ?? []);
    const limits = await backend.settings("limits");
    setTokenLimit(String(limits.agent_token_limit ?? 0));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return backend.onEvent((event) => {
      if (event.type === "ready") {
        setUnusable(
          (event.unusable_write_directories as {
            path: string;
            reason: string;
          }[]) ?? [],
        );
      }
    });
  }, []);

  const save = async (values: Record<string, unknown>, section: string) => {
    setStatus(null);
    try {
      await backend.updateSettings(section, values);
      setStatus("Saved");
      await load();
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const addDirectory = async () => {
    if (!draft.trim()) return;
    await save(
      { write_directories: [...directories, draft.trim()] },
      "execution",
    );
    setDraft("");
  };

  const removeDirectory = async (path: string) => {
    await save(
      { write_directories: directories.filter((item) => item !== path) },
      "execution",
    );
  };

  return (
    <>
      <Panel title="Settings">
        <Row title="Model" meta="Provider and credentials" selected />
        <Row title="Execution" meta={`${directories.length} writable`} />
        <Row
          title="Limits"
          meta={
            Number(tokenLimit) > 0
              ? `${Number(tokenLimit).toLocaleString()} tokens per Agent`
              : "No ceiling"
          }
        />
      </Panel>
      <Main title="Settings" banner={status}>
        <div className="detail">
          <section>
            <h3>Writable directories</h3>
            <p className="row-meta">
              Agents can read anything you can read, but only write inside
              these.
            </p>
            {unusable.length > 0 ? (
              <ul className="detail-list">
                {unusable.map((item) => (
                  <li key={item.path} className="detail-item">
                    <span className="mono">{item.path}</span>
                    <Badge tone="pending">{item.reason}</Badge>
                  </li>
                ))}
              </ul>
            ) : null}
            <ul className="detail-list">
              {directories.length === 0 ? (
                <li className="row-meta">
                  None configured. Agents cannot write anything.
                </li>
              ) : (
                directories.map((path) => (
                  <li key={path} className="detail-item">
                    <span className="mono">{path}</span>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => removeDirectory(path)}
                    >
                      Remove
                    </Button>
                  </li>
                ))
              )}
            </ul>
            <div className="composer-actions">
              <Input
                value={draft}
                placeholder="Absolute path to allow writing"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) =>
                  event.key === "Enter" && void addDirectory()
                }
              />
              <Button onClick={addDirectory} disabled={!draft.trim()}>
                Add
              </Button>
            </div>
          </section>
          <section>
            <h3>Limits</h3>
            <p className="row-meta">
              An Agent that reaches its ceiling stops being scheduled. Raise the
              limit to let it continue. Use 0 for no ceiling.
            </p>
            <div className="composer-actions">
              <Input
                value={tokenLimit}
                inputMode="numeric"
                placeholder="Cumulative tokens per Agent"
                onChange={(event) => setTokenLimit(event.target.value)}
              />
              <Button
                onClick={() =>
                  save({ agent_token_limit: Number(tokenLimit) || 0 }, "limits")
                }
              >
                Save limit
              </Button>
            </div>
          </section>
          <section>
            <h3>Model</h3>
            <div className="form-grid">
              <label className="form-row">
                Provider
                <Input
                  value={String(model.api_type ?? "openai")}
                  onChange={(event) =>
                    setModel({ ...model, api_type: event.target.value })
                  }
                />
              </label>
              <label className="form-row">
                Base URL
                <Input
                  value={String(model.base_url ?? "")}
                  onChange={(event) =>
                    setModel({ ...model, base_url: event.target.value })
                  }
                />
              </label>
              <label className="form-row">
                Model
                <Input
                  value={String(model.model ?? "")}
                  onChange={(event) =>
                    setModel({ ...model, model: event.target.value })
                  }
                />
              </label>
              <label className="form-row">
                API key {model.api_key_set ? "(already configured)" : ""}
                <Input
                  type="password"
                  value={apiKey}
                  placeholder={
                    model.api_key_set ? "Leave blank to keep" : "Required"
                  }
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
              <Button
                variant="primary"
                onClick={async () => {
                  const values: Record<string, unknown> = {
                    api_type: model.api_type,
                    base_url: model.base_url,
                    model: model.model,
                  };
                  if (apiKey.trim()) values.api_key = apiKey.trim();
                  await save(values, "model");
                  setApiKey("");
                }}
              >
                Save model settings
              </Button>
              <p className="row-meta">
                Changing the model takes effect the next time Huddol starts.
              </p>
            </div>
          </section>
        </div>
      </Main>
    </>
  );
}

export default function App() {
  const [section, setSection] = useState<Section>("discussions");
  const { members, refresh } = useOrganization();
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    backend
      .connect()
      .then(refresh)
      .then(() => setReady(true))
      .catch((error) => setFailure(String(error)));
  }, [refresh]);

  useEffect(() => {
    return backend.onEvent((event) => {
      if (event.type.startsWith("member.") || event.type.startsWith("turn.")) {
        void refresh();
      }
    });
  }, [refresh]);

  if (failure) {
    return (
      <EmptyState
        title="Cannot reach the Huddol backend"
        description={failure}
      />
    );
  }
  if (!ready) {
    return <EmptyState title="Starting Huddol…" />;
  }

  return (
    <Shell>
      <Rail active={section} onSelect={setSection} />
      {section === "discussions" ? (
        <DiscussionsView members={members} />
      ) : section === "members" ? (
        <MembersView members={members} refresh={refresh} />
      ) : section === "library" ? (
        <LibraryView />
      ) : (
        <SettingsView />
      )}
    </Shell>
  );
}
