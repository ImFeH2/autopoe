use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Mutex, RwLock},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, ipc::Channel};
use tauri_plugin_shell::{
    ShellExt,
    process::{Command, CommandChild, CommandEvent},
};
use tokio::sync::{Notify, oneshot};
use uuid::Uuid;

use crate::commands::RunEvent;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum RuntimeStatus {
    Starting,
    Ready,
    Stopped,
    Failed { message: String },
}

#[derive(Debug, Deserialize)]
struct Envelope {
    kind: String,
    name: String,
    #[serde(default)]
    scope: Option<Scope>,
    #[serde(default)]
    payload: Value,
}

#[derive(Debug, Deserialize)]
struct Scope {
    #[serde(default)]
    run_id: Option<String>,
}

struct RunSink {
    events: Channel<RunEvent>,
    terminal: oneshot::Sender<Result<(), String>>,
}

pub struct RuntimeManager {
    child: Mutex<Option<CommandChild>>,
    status: RwLock<RuntimeStatus>,
    ready: Notify,
    runs: Mutex<HashMap<String, RunSink>>,
}

impl Default for RuntimeManager {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            status: RwLock::new(RuntimeStatus::Stopped),
            ready: Notify::new(),
            runs: Mutex::new(HashMap::new()),
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

    pub fn send_request(
        &self,
        name: &str,
        payload: Value,
        run_id: Option<String>,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().simple().to_string();
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
            .map_err(|error| error.to_string())?;

        Ok(id)
    }

    pub fn register_run(
        &self,
        run_id: String,
        events: Channel<RunEvent>,
        terminal: oneshot::Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let mut runs = self.runs.lock().expect("runtime runs lock");
        if runs.contains_key(&run_id) {
            return Err("Agent run is already registered".to_owned());
        }
        runs.insert(run_id, RunSink { events, terminal });
        Ok(())
    }

    pub fn fail_run(&self, run_id: &str, message: String) {
        self.finish_run(
            run_id,
            RunEvent::Failed {
                message: message.clone(),
            },
            Err(message),
        );
    }

    pub fn fail(&self, message: String) {
        self.set_status(RuntimeStatus::Failed {
            message: message.clone(),
        });
        self.fail_all_runs(message);
    }

    fn handle_stdout(&self, app: &AppHandle, line: &[u8]) {
        let envelope = match serde_json::from_slice::<Envelope>(line) {
            Ok(envelope) => envelope,
            Err(error) => {
                self.fail(format!("Invalid JSONL from Python runtime: {error}"));
                return;
            }
        };

        match (envelope.kind.as_str(), envelope.name.as_str()) {
            ("event", "runtime.hello") => {
                let data_dir = app
                    .path()
                    .app_data_dir()
                    .map(|path| path.to_string_lossy().into_owned())
                    .unwrap_or_default();
                if let Err(error) = self.send_request(
                    "runtime.initialize",
                    serde_json::json!({
                        "app_version": app.package_info().version.to_string(),
                        "data_dir": data_dir,
                    }),
                    None,
                ) {
                    self.fail(error);
                }
            }
            ("event", "runtime.ready") => self.set_status(RuntimeStatus::Ready),
            ("response", "runtime.error") => {
                if let Some(run_id) = envelope.scope.and_then(|scope| scope.run_id) {
                    let message = envelope
                        .payload
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Python runtime rejected the request")
                        .to_owned();
                    self.fail_run(&run_id, message);
                }
            }
            ("event", name) if name.starts_with("agent.") => {
                if let Some(run_id) = envelope.scope.and_then(|scope| scope.run_id) {
                    self.dispatch_agent_event(&run_id, name, envelope.payload);
                }
            }
            _ => {}
        }
    }

    fn dispatch_agent_event(&self, run_id: &str, name: &str, payload: Value) {
        match name {
            "agent.started" => self.send_run_event(run_id, RunEvent::Started),
            "agent.text_delta" => {
                if let Some(delta) = payload.get("delta").and_then(Value::as_str) {
                    self.send_run_event(
                        run_id,
                        RunEvent::TextDelta {
                            delta: delta.to_owned(),
                        },
                    );
                }
            }
            "agent.completed" => self.finish_run(run_id, RunEvent::Completed, Ok(())),
            "agent.cancelled" => self.finish_run(
                run_id,
                RunEvent::Cancelled,
                Err("Agent run was cancelled".to_owned()),
            ),
            "agent.failed" => {
                let message = payload
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Agent run failed")
                    .to_owned();
                self.fail_run(run_id, message);
            }
            _ => {}
        }
    }

    fn send_run_event(&self, run_id: &str, event: RunEvent) {
        if let Some(run) = self.runs.lock().expect("runtime runs lock").get(run_id) {
            let _ = run.events.send(event);
        }
    }

    fn finish_run(&self, run_id: &str, event: RunEvent, result: Result<(), String>) {
        if let Some(run) = self.runs.lock().expect("runtime runs lock").remove(run_id) {
            let _ = run.events.send(event);
            let _ = run.terminal.send(result);
        }
    }

    fn terminate(&self, code: Option<i32>, signal: Option<i32>) {
        *self.child.lock().expect("runtime child lock") = None;
        let message =
            format!("Python runtime exited unexpectedly: code={code:?}, signal={signal:?}");
        self.fail(message);
    }

    fn fail_all_runs(&self, message: String) {
        let runs = std::mem::take(&mut *self.runs.lock().expect("runtime runs lock"));
        for (_, run) in runs {
            let _ = run.events.send(RunEvent::Failed {
                message: message.clone(),
            });
            let _ = run.terminal.send(Err(message.clone()));
        }
    }

    fn set_status(&self, status: RuntimeStatus) {
        *self.status.write().expect("runtime status lock") = status;
        self.ready.notify_waiters();
    }
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
        .arg("flowent-agent"))
}

#[cfg(not(debug_assertions))]
fn runtime_command(app: &AppHandle) -> Result<Command, String> {
    app.shell()
        .sidecar("flowent-agent")
        .map_err(|error| error.to_string())
}
