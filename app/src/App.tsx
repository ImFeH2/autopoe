import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { formatTime, highlightMentions } from "./features/mentions";
import "./features/features.css";
import {
  type AgentDetail,
  backend,
  type DiscussionDetail,
  type DiscussionSummary,
  type LibraryEntry,
  type Member,
} from "./lib/backend";

function useOrganization() {
  const [members, setMembers] = useState<Member[]>([]);
  const [humanId, setHumanId] = useState(1);
  const refresh = useCallback(async () => {
    const organization = await backend.organization();
    setMembers(organization.members);
    setHumanId(organization.human_id);
  }, []);
  return { members, humanId, refresh };
}

function DiscussionsView({
  members,
  humanId,
}: {
  members: Member[];
  humanId: number;
}) {
  const [list, setList] = useState<DiscussionSummary[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<DiscussionDetail | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, []);

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

  const mentionsMe = (text: string) => {
    const me = members.find((member) => member.id === humanId);
    return me
      ? text.toLowerCase().includes(`@${me.name.toLowerCase()}`)
      : false;
  };

  return (
    <>
      <Panel title="Discussions">
        {list.length === 0 ? (
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
              {detail.messages.map((message) => (
                <article
                  key={message.id}
                  className="message"
                  data-mentions-you={mentionsMe(message.body)}
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
                  </div>
                </article>
              ))}
              <div ref={bottom} />
            </div>
            <div className="composer">
              <Textarea
                value={body}
                placeholder="Write a message. Use @Name to notify a Member."
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
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
            meta={item.type === "human" ? "Human" : item.state}
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
              <h3>Recent turns</h3>
              <ul className="detail-list">
                {detail.runs.slice(0, 10).map((run) => (
                  <li key={run.sequence} className="detail-item">
                    <span className="mono">#{run.sequence}</span>
                    <span className="row-meta">
                      {formatTime(run.started_at)}
                    </span>
                    <Badge
                      tone={run.status === "completed" ? "default" : "pending"}
                    >
                      {run.status}
                    </Badge>
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

  useEffect(() => {
    void backend.library().then(setEntries);
  }, []);

  useEffect(() => {
    if (selected)
      void backend.readLibrary(selected).then((doc) => setContent(doc.content));
  }, [selected]);

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
      </Panel>
      <Main title={selected ?? "Select a document"}>
        {selected ? (
          <div className="messages">
            <div className="message-text">{content}</div>
          </div>
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
  const [execution, setExecution] = useState<Record<string, unknown>>({});

  useEffect(() => {
    void backend.settings("model").then(setModel);
    void backend.settings("execution").then(setExecution);
  }, []);

  return (
    <>
      <Panel title="Settings">
        <Row title="Model" meta="Provider and credentials" selected />
        <Row title="Execution" meta="Writable directories" />
      </Panel>
      <Main title="Settings">
        <div className="detail">
          <section>
            <h3>Model</h3>
            <div className="form-grid">
              <label className="form-row">
                Provider
                <Input readOnly value={String(model.api_type ?? "")} />
              </label>
              <label className="form-row">
                Model
                <Input readOnly value={String(model.model ?? "")} />
              </label>
              <label className="form-row">
                API key
                <Input
                  readOnly
                  value={model.api_key_set ? "configured" : "not set"}
                />
              </label>
            </div>
          </section>
          <section>
            <h3>Writable directories</h3>
            <ul className="detail-list">
              {((execution.write_directories as string[]) ?? []).map((path) => (
                <li key={path} className="detail-item">
                  <span className="mono">{path}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </Main>
    </>
  );
}

export default function App() {
  const [section, setSection] = useState<Section>("discussions");
  const { members, humanId, refresh } = useOrganization();
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
        <DiscussionsView members={members} humanId={humanId} />
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
