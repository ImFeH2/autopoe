import { useCallback, useEffect, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { type AgentTodo, type AgentTodoPage, backend } from "@/lib/backend";

type TodoState =
  | { status: "loading" }
  | {
      status: "ready";
      current: AgentTodo[];
      pending: AgentTodoPage;
      completed: AgentTodoPage;
      completedExpanded: boolean;
      completedFullyLoaded: boolean;
    }
  | { status: "error"; message: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function TodoRow({ todo }: { todo: AgentTodo }) {
  const label =
    todo.status === "in_progress"
      ? "In progress"
      : todo.status === "completed"
        ? "Completed"
        : "Pending";
  const tone =
    todo.status === "in_progress"
      ? "accent"
      : todo.status === "completed"
        ? "success"
        : "neutral";
  return (
    <article className="agent-todo-row">
      <div className="agent-todo-row__heading">
        <strong className="agent-todo-subject">{todo.subject}</strong>
        <Badge size="small" tone={tone}>
          {label}
        </Badge>
      </div>
      {todo.description ? <p>{todo.description}</p> : null}
      <time className="agent-todo-time" dateTime={todo.updated_at}>
        Updated {formatTime(todo.updated_at)}
      </time>
    </article>
  );
}

export function AgentTodos({ agentId }: { agentId: number }) {
  const [state, setState] = useState<TodoState>({ status: "loading" });

  const refresh = useCallback(() => {
    let active = true;
    setState({ status: "loading" });
    void Promise.all([
      backend.listAgentTodos(agentId, "in_progress", 1),
      backend.listAgentTodos(agentId, "pending", 5),
      backend.listAgentTodos(agentId, "completed", 1),
    ])
      .then(([current, pending, completed]) => {
        if (active) {
          setState({
            status: "ready",
            current: current.todos,
            pending,
            completed,
            completedExpanded: false,
            completedFullyLoaded: !completed.has_more,
          });
        }
      })
      .catch((error) => {
        if (active) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
    return () => {
      active = false;
    };
  }, [agentId]);

  useEffect(() => refresh(), [refresh]);

  async function loadMorePending() {
    if (state.status !== "ready" || !state.pending.next_cursor) {
      return;
    }
    try {
      const page = await backend.listAgentTodos(
        agentId,
        "pending",
        50,
        state.pending.next_cursor,
      );
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              pending: {
                ...page,
                todos: [...current.pending.todos, ...page.todos],
                count: current.pending.todos.length + page.todos.length,
              },
            }
          : current,
      );
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    }
  }

  async function toggleCompleted(open: boolean) {
    if (state.status !== "ready") {
      return;
    }
    if (!open) {
      setState({ ...state, completedExpanded: false });
      return;
    }
    if (state.completedExpanded) {
      return;
    }
    if (state.completedFullyLoaded && state.completed.limit === 50) {
      setState({ ...state, completedExpanded: true });
      return;
    }
    try {
      const completed = await backend.listAgentTodos(agentId, "completed", 50);
      setState({
        ...state,
        completed,
        completedExpanded: true,
        completedFullyLoaded: !completed.has_more,
      });
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    }
  }

  async function loadMoreCompleted() {
    if (state.status !== "ready" || !state.completed.next_cursor) {
      return;
    }
    try {
      const page = await backend.listAgentTodos(
        agentId,
        "completed",
        50,
        state.completed.next_cursor,
      );
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              completed: {
                ...page,
                todos: [...current.completed.todos, ...page.todos],
                count: current.completed.todos.length + page.todos.length,
              },
              completedFullyLoaded: !page.has_more,
            }
          : current,
      );
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    }
  }

  const noTodos =
    state.status === "ready" &&
    state.current.length === 0 &&
    state.pending.todos.length === 0 &&
    state.completed.todos.length === 0;

  return (
    <section className="agent-todos" aria-labelledby={`agent-${agentId}-todos`}>
      <header className="agent-section-header">
        <div>
          <h3 id={`agent-${agentId}-todos`}>Todos</h3>
          <p>
            Todo is the Agent&apos;s task record. It does not schedule a Turn or
            mean the Agent is currently running.
          </p>
        </div>
        <Button onClick={refresh} size="compact" variant="quiet">
          Refresh
        </Button>
      </header>
      {state.status === "loading" ? (
        <p className="agent-section-empty" aria-live="polite">
          Loading Todos
        </p>
      ) : state.status === "error" ? (
        <div className="agent-section-empty" role="alert">
          <p>{state.message}</p>
          <Button onClick={refresh} size="compact">
            Retry
          </Button>
        </div>
      ) : noTodos ? (
        <p className="agent-section-empty">This Agent has no Todos yet.</p>
      ) : (
        <div className="agent-todo-groups">
          <section aria-labelledby={`agent-${agentId}-active-todos`}>
            <h4 id={`agent-${agentId}-active-todos`}>Active</h4>
            {state.current.length === 0 && state.pending.todos.length === 0 ? (
              <p className="agent-section-empty">
                No in-progress or pending Todos.
              </p>
            ) : (
              <div className="agent-todo-list">
                {[...state.current, ...state.pending.todos].map((todo) => (
                  <TodoRow key={todo.id} todo={todo} />
                ))}
              </div>
            )}
            {state.pending.has_more ? (
              <Button
                onClick={() => void loadMorePending()}
                size="compact"
                variant="quiet"
              >
                {state.pending.limit === 5 ? "Show all" : "Load more"}
              </Button>
            ) : null}
          </section>
          <details
            className="agent-completed-todos"
            onToggle={(event) => void toggleCompleted(event.currentTarget.open)}
            open={state.completedExpanded}
          >
            <summary>Completed</summary>
            {state.completed.todos.length === 0 ? (
              <p className="agent-section-empty">No completed Todos.</p>
            ) : (
              <div className="agent-todo-list">
                {state.completed.todos.map((todo) => (
                  <TodoRow key={todo.id} todo={todo} />
                ))}
              </div>
            )}
            {state.completed.has_more ? (
              <Button
                onClick={() => void loadMoreCompleted()}
                size="compact"
                variant="quiet"
              >
                Load more
              </Button>
            ) : null}
          </details>
        </div>
      )}
    </section>
  );
}
