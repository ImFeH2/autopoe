use std::{
    collections::HashMap,
    sync::{Mutex, RwLock},
    time::Duration,
};

#[cfg(debug_assertions)]
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, ipc::Channel};
use tauri_plugin_shell::{
    ShellExt,
    process::{Command, CommandChild, CommandEvent},
};
use tokio::sync::{Notify, oneshot};
use uuid::Uuid;

use crate::commands::{RunEvent, RuntimeEvent};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum RuntimeStatus {
    Starting,
    Ready,
    Stopped,
    Failed { message: String },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Scope {
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub workflow_run_id: Option<String>,
    #[serde(default)]
    pub agent_run_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Envelope {
    kind: String,
    name: String,
    #[serde(default)]
    reply_to: Option<String>,
    #[serde(default)]
    sequence: Option<u64>,
    #[serde(default)]
    scope: Option<Scope>,
    #[serde(default)]
    payload: Value,
}

struct AgentRunSink {
    events: Channel<RunEvent>,
    terminal: oneshot::Sender<Result<(), String>>,
}

struct WorkflowRunSink {
    events: Channel<RuntimeEvent>,
    terminal: oneshot::Sender<Result<Value, String>>,
}

pub struct RuntimeManager {
    child: Mutex<Option<CommandChild>>,
    status: RwLock<RuntimeStatus>,
    ready: Notify,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
    agent_runs: Mutex<HashMap<String, AgentRunSink>>,
    workflow_runs: Mutex<HashMap<String, WorkflowRunSink>>,
}

impl Default for RuntimeManager {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            status: RwLock::new(RuntimeStatus::Stopped),
            ready: Notify::new(),
            pending: Mutex::new(HashMap::new()),
            agent_runs: Mutex::new(HashMap::new()),
            workflow_runs: Mutex::new(HashMap::new()),
        }
    }
}

impl RuntimeManager {
    pub fn start(&self, app: AppHandle) -> Result<(), String> {
        self.set_status(RuntimeStatus::Starting);
        let command = runtime_command(&app)?;
        let (mut receiver, child) = command.spawn().map_err(|error| error.to_string())?;
        *self.child.lock().expect("runtime child lock") = Some(child);

        tauri::async_runtime::spawn(async move {
            while let Some(event) = receiver.recv().await {
                let runtime = app.state::<RuntimeManager>();
                match event {
                    CommandEvent::Stdout(line) => runtime.handle_stdout(&app, &line),
                    CommandEvent::Stderr(line) => {
                        let message = String::from_utf8_lossy(&line);
                        eprintln!("flowent-agent: {message}");
                    }
                    CommandEvent::Error(message) => runtime.fail(message),
                    CommandEvent::Terminated(payload) => {
                        runtime.terminate(payload.code, payload.signal);
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    pub fn status(&self) -> RuntimeStatus {
        self.status.read().expect("runtime status lock").clone()
    }

    pub async fn wait_until_ready(&self) -> Result<(), String> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
        loop {
            let notified = self.ready.notified();
            match self.status() {
                RuntimeStatus::Ready => return Ok(()),
                RuntimeStatus::Failed { message } => return Err(message),
                RuntimeStatus::Stopped => return Err("Python runtime is not running".to_owned()),
                RuntimeStatus::Starting => {}
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                return Err("Python runtime did not become ready in time".to_owned());
            }
        }
    }

    pub async fn request(
        &self,
        name: &str,
        payload: Value,
        run_id: Option<String>,
    ) -> Result<Value, String> {
        let id = Uuid::new_v4().simple().to_string();
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .expect("runtime pending lock")
            .insert(id.clone(), sender);
        if let Err(error) = self.write_request(&id, name, payload, run_id) {
            self.pending
                .lock()
                .expect("runtime pending lock")
                .remove(&id);
            return Err(error);
        }
        match tokio::time::timeout(Duration::from_secs(30), receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("Python runtime dropped the response".to_owned()),
            Err(_) => {
                self.pending
                    .lock()
                    .expect("runtime pending lock")
                    .remove(&id);
                Err(format!("Python runtime request timed out: {name}"))
            }
        }
    }

    pub fn register_agent_run(
        &self,
        run_id: String,
        events: Channel<RunEvent>,
        terminal: oneshot::Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let mut runs = self.agent_runs.lock().expect("agent runs lock");
        if runs.contains_key(&run_id) {
            return Err("Agent run is already registered".to_owned());
        }
        runs.insert(run_id, AgentRunSink { events, terminal });
        Ok(())
    }

    pub fn register_workflow_run(
        &self,
        run_id: String,
        events: Channel<RuntimeEvent>,
        terminal: oneshot::Sender<Result<Value, String>>,
    ) -> Result<(), String> {
        let mut runs = self.workflow_runs.lock().expect("workflow runs lock");
        if runs.contains_key(&run_id) {
            return Err("Workflow run is already registered".to_owned());
        }
        runs.insert(run_id, WorkflowRunSink { events, terminal });
        Ok(())
    }

    pub fn fail_agent_run(&self, run_id: &str, message: String) {
        if let Some(run) = self
            .agent_runs
            .lock()
            .expect("agent runs lock")
            .remove(run_id)
        {
            let _ = run.events.send(RunEvent::Failed {
                message: message.clone(),
            });
            let _ = run.terminal.send(Err(message));
        }
    }

    pub fn fail_workflow_run(&self, run_id: &str, message: String) {
        if let Some(run) = self
            .workflow_runs
            .lock()
            .expect("workflow runs lock")
            .remove(run_id)
        {
            let _ = run.terminal.send(Err(message));
        }
    }

    pub fn fail(&self, message: String) {
        self.set_status(RuntimeStatus::Failed {
            message: message.clone(),
        });
        self.fail_all(message);
    }

    fn write_request(
        &self,
        id: &str,
        name: &str,
        payload: Value,
        run_id: Option<String>,
    ) -> Result<(), String> {
        let mut envelope = serde_json::json!({
            "protocol_version": 1,
            "id": id,
            "kind": "request",
            "name": name,
            "payload": payload,
        });
        if let Some(run_id) = run_id {
            envelope["scope"] = serde_json::json!({ "run_id": run_id });
        }
        let mut data = serde_json::to_vec(&envelope).map_err(|error| error.to_string())?;
        data.push(b'\n');
        self.child
            .lock()
            .expect("runtime child lock")
            .as_mut()
            .ok_or_else(|| "Python runtime is not running".to_owned())?
            .write(&data)
            .map_err(|error| error.to_string())
    }

    fn send_untracked_request(
        &self,
        name: &str,
        payload: Value,
        run_id: Option<String>,
    ) -> Result<(), String> {
        self.write_request(&Uuid::new_v4().simple().to_string(), name, payload, run_id)
    }

    fn handle_stdout(&self, app: &AppHandle, line: &[u8]) {
        let envelope = match serde_json::from_slice::<Envelope>(line) {
            Ok(envelope) => envelope,
            Err(error) => {
                self.fail(format!("Invalid JSONL from Python runtime: {error}"));
                return;
            }
        };

        if envelope.kind == "event" && envelope.name == "runtime.hello" {
            let data_dir = app
                .path()
                .app_data_dir()
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_default();
            if let Err(error) = self.send_untracked_request(
                "runtime.initialize",
                serde_json::json!({
                    "app_version": app.package_info().version.to_string(),
                    "data_dir": data_dir,
                }),
                None,
            ) {
                self.fail(error);
            }
            return;
        }
        if envelope.kind == "event" && envelope.name == "runtime.ready" {
            self.set_status(RuntimeStatus::Ready);
            return;
        }
        if envelope.kind == "response" {
            self.dispatch_response(envelope);
            return;
        }
        if envelope.kind == "event" {
            self.dispatch_event(envelope);
        }
    }

    fn dispatch_response(&self, envelope: Envelope) {
        let Some(reply_to) = envelope.reply_to else {
            return;
        };
        let sender = self
            .pending
            .lock()
            .expect("runtime pending lock")
            .remove(&reply_to);
        let Some(sender) = sender else {
            if envelope.name == "runtime.error" {
                self.fail(payload_message(
                    &envelope.payload,
                    "Python runtime rejected initialization",
                ));
            }
            return;
        };
        if envelope.name == "runtime.error" {
            let message = payload_message(&envelope.payload, "Python runtime rejected the request");
            let _ = sender.send(Err(message));
        } else {
            let _ = sender.send(Ok(envelope.payload));
        }
    }

    fn dispatch_event(&self, envelope: Envelope) {
        let run_id = envelope
            .scope
            .as_ref()
            .and_then(|scope| scope.run_id.as_deref())
            .map(str::to_owned);
        let Some(run_id) = run_id else {
            return;
        };

        if envelope.name.starts_with("agent.") {
            self.dispatch_agent_event(&run_id, &envelope.name, &envelope.payload);
        }

        let event = RuntimeEvent {
            name: envelope.name.clone(),
            sequence: envelope.sequence,
            scope: envelope.scope,
            payload: envelope.payload.clone(),
        };
        if let Some(run) = self
            .workflow_runs
            .lock()
            .expect("workflow runs lock")
            .get(&run_id)
        {
            let _ = run.events.send(event);
        }

        match envelope.name.as_str() {
            "workflow.completed" => self.finish_workflow_run(&run_id, Ok(envelope.payload)),
            "workflow.failed" => {
                let message = payload_message(&envelope.payload, "Workflow run failed");
                self.finish_workflow_run(&run_id, Err(message));
            }
            "workflow.cancelled" => {
                self.finish_workflow_run(&run_id, Err("Workflow run was cancelled".to_owned()));
            }
            _ => {}
        }
    }

    fn dispatch_agent_event(&self, run_id: &str, name: &str, payload: &Value) {
        match name {
            "agent.started" => self.send_agent_event(run_id, RunEvent::Started),
            "agent.text_delta" => {
                if let Some(delta) = payload.get("delta").and_then(Value::as_str) {
                    self.send_agent_event(
                        run_id,
                        RunEvent::TextDelta {
                            delta: delta.to_owned(),
                        },
                    );
                }
            }
            "agent.completed" => self.finish_agent_run(run_id, RunEvent::Completed, Ok(())),
            "agent.cancelled" => self.finish_agent_run(
                run_id,
                RunEvent::Cancelled,
                Err("Agent run was cancelled".to_owned()),
            ),
            "agent.failed" => {
                let message = payload_message(payload, "Agent run failed");
                self.fail_agent_run(run_id, message);
            }
            _ => {}
        }
    }

    fn send_agent_event(&self, run_id: &str, event: RunEvent) {
        if let Some(run) = self.agent_runs.lock().expect("agent runs lock").get(run_id) {
            let _ = run.events.send(event);
        }
    }

    fn finish_agent_run(&self, run_id: &str, event: RunEvent, result: Result<(), String>) {
        if let Some(run) = self
            .agent_runs
            .lock()
            .expect("agent runs lock")
            .remove(run_id)
        {
            let _ = run.events.send(event);
            let _ = run.terminal.send(result);
        }
    }

    fn finish_workflow_run(&self, run_id: &str, result: Result<Value, String>) {
        if let Some(run) = self
            .workflow_runs
            .lock()
            .expect("workflow runs lock")
            .remove(run_id)
        {
            let _ = run.terminal.send(result);
        }
    }

    fn terminate(&self, code: Option<i32>, signal: Option<i32>) {
        *self.child.lock().expect("runtime child lock") = None;
        self.fail(format!(
            "Python runtime exited unexpectedly: code={code:?}, signal={signal:?}"
        ));
    }

    fn fail_all(&self, message: String) {
        let pending = std::mem::take(&mut *self.pending.lock().expect("runtime pending lock"));
        for (_, sender) in pending {
            let _ = sender.send(Err(message.clone()));
        }
        let agent_runs = std::mem::take(&mut *self.agent_runs.lock().expect("agent runs lock"));
        for (_, run) in agent_runs {
            let _ = run.events.send(RunEvent::Failed {
                message: message.clone(),
            });
            let _ = run.terminal.send(Err(message.clone()));
        }
        let workflow_runs =
            std::mem::take(&mut *self.workflow_runs.lock().expect("workflow runs lock"));
        for (_, run) in workflow_runs {
            let _ = run.terminal.send(Err(message.clone()));
        }
    }

    fn set_status(&self, status: RuntimeStatus) {
        *self.status.write().expect("runtime status lock") = status;
        self.ready.notify_waiters();
    }
}

fn payload_message(payload: &Value, fallback: &str) -> String {
    payload
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .to_owned()
}

#[cfg(debug_assertions)]
fn runtime_command(app: &AppHandle) -> Result<Command, String> {
    let agent_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../agent");
    Ok(app
        .shell()
        .command("uv")
        .arg("run")
        .arg("--project")
        .arg(agent_dir)
        .arg("flowent"))
}

#[cfg(not(debug_assertions))]
fn runtime_command(app: &AppHandle) -> Result<Command, String> {
    app.shell()
        .sidecar("flowent-agent")
        .map_err(|error| error.to_string())
}
