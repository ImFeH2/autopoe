use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use crate::bridge_diagnostics::{BridgeDiagnostics, os_error_code};
use anyhow::{Context, Result};
use serde_json::{Value, json};
use tauri::{AppHandle, ipc::Channel};
use tauri_plugin_shell::{
    ShellExt,
    process::{CommandChild, CommandEvent},
};

const FLOWENT_BINARY: &str = "flowent";
const FLOWENT_DEVELOPMENT_PYTHON: &str = "FLOWENT_DEVELOPMENT_PYTHON";
const SHUTDOWN_ID: u64 = u64::MAX;

#[derive(Debug, PartialEq)]
enum FlowentExecutable {
    Development(PathBuf),
    Sidecar,
}

fn resolve_flowent_executable(
    is_dev: bool,
    development_python: Option<PathBuf>,
) -> Result<FlowentExecutable> {
    if is_dev {
        return development_python
            .map(FlowentExecutable::Development)
            .context("Flowent development Python is not configured");
    }
    Ok(FlowentExecutable::Sidecar)
}

type SharedChild = Arc<Mutex<Option<CommandChild>>>;
type SharedSubscriber = Arc<Mutex<Option<Channel<Value>>>>;
type SharedDiagnostics = Arc<BridgeDiagnostics>;
type SharedCounters = Arc<BridgeCounters>;

#[derive(Default)]
struct BridgeCounters {
    stdout_line_count: AtomicU64,
    stdout_message_count: AtomicU64,
    stderr_line_count: AtomicU64,
    request_write_count: AtomicU64,
    forward_failure_count: AtomicU64,
    shutdown_requested: AtomicBool,
    last_request: Mutex<Option<(Option<u64>, &'static str)>>,
}

impl BridgeCounters {
    fn record_request(&self, request_id: Option<u64>, method: &'static str) {
        self.request_write_count.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut last_request) = self.last_request.lock() {
            *last_request = Some((request_id, method));
        }
    }

    fn snapshot(&self) -> Value {
        let last_request = self
            .last_request
            .lock()
            .ok()
            .and_then(|last_request| *last_request);
        json!({
            "stdout_line_count": self.stdout_line_count.load(Ordering::Relaxed),
            "stdout_message_count": self.stdout_message_count.load(Ordering::Relaxed),
            "stderr_line_count": self.stderr_line_count.load(Ordering::Relaxed),
            "request_write_count": self.request_write_count.load(Ordering::Relaxed),
            "forward_failure_count": self.forward_failure_count.load(Ordering::Relaxed),
            "shutdown_requested": self.shutdown_requested.load(Ordering::Relaxed),
            "last_request_id": last_request.and_then(|(request_id, _)| request_id),
            "last_request_method": last_request.map(|(_, method)| method),
        })
    }
}

pub struct FlowentProcess {
    child: SharedChild,
    subscriber: SharedSubscriber,
    diagnostics: SharedDiagnostics,
    counters: SharedCounters,
    working_directory: PathBuf,
}

impl Default for FlowentProcess {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            subscriber: Arc::new(Mutex::new(None)),
            diagnostics: Arc::new(BridgeDiagnostics::default()),
            counters: Arc::new(BridgeCounters::default()),
            working_directory: std::env::var_os("FLOWENT_WORKING_DIRECTORY")
                .map(PathBuf::from)
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))),
        }
    }
}

impl FlowentProcess {
    pub fn start(&self, app: &AppHandle) -> Result<()> {
        self.diagnostics.record(
            "INFO",
            "bridge.process.starting",
            json!({"development": tauri::is_dev()}),
        );
        let shell = app.shell();
        let executable = match resolve_flowent_executable(
            tauri::is_dev(),
            std::env::var_os(FLOWENT_DEVELOPMENT_PYTHON).map(PathBuf::from),
        ) {
            Ok(executable) => executable,
            Err(error) => {
                self.diagnostics.record(
                    "ERROR",
                    "bridge.process.start_failed",
                    json!({
                        "stage": "executable_resolution",
                        "error_type": "configuration_error",
                    }),
                );
                return Err(error);
            }
        };
        let (command, executable_kind) = match executable {
            FlowentExecutable::Development(python) => (
                shell.command(python).args(["-m", "flowent"]),
                "development_python",
            ),
            FlowentExecutable::Sidecar => {
                let command = match shell.sidecar(FLOWENT_BINARY) {
                    Ok(command) => command,
                    Err(error) => {
                        self.diagnostics.record(
                            "ERROR",
                            "bridge.process.start_failed",
                            json!({
                                "stage": "sidecar_resolution",
                                "error_type": "shell_error",
                            }),
                        );
                        return Err(error).context("create Flowent sidecar command");
                    }
                };
                (command, "sidecar")
            }
        };
        let command = command
            .env_clear()
            .envs(std::env::vars_os())
            .current_dir(&self.working_directory);
        let (mut events, child) = match command.spawn() {
            Ok(process) => process,
            Err(error) => {
                self.diagnostics.record(
                    "ERROR",
                    "bridge.process.start_failed",
                    json!({
                        "stage": "spawn",
                        "error_type": "shell_error",
                        "os_error_code": os_error_code(&error.to_string()),
                        "executable_kind": executable_kind,
                    }),
                );
                return Err(error).context("start Flowent");
            }
        };
        let child_pid = child.pid();
        match self.child.lock() {
            Ok(mut shared_child) => *shared_child = Some(child),
            Err(_) => {
                let _ = child.kill();
                self.diagnostics.record(
                    "ERROR",
                    "bridge.process.start_failed",
                    json!({
                        "stage": "child_registration",
                        "error_type": "lock_poisoned",
                        "child_pid": child_pid,
                    }),
                );
                return Err(anyhow::anyhow!("Flowent child lock poisoned"));
            }
        }
        self.diagnostics.record(
            "INFO",
            "bridge.process.started",
            json!({
                "child_pid": child_pid,
                "executable_kind": executable_kind,
            }),
        );

        let shared_child = Arc::clone(&self.child);
        let subscriber = Arc::clone(&self.subscriber);
        let diagnostics = Arc::clone(&self.diagnostics);
        let counters = Arc::clone(&self.counters);
        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        counters.stdout_line_count.fetch_add(1, Ordering::Relaxed);
                        let message = match serde_json::from_slice(&line) {
                            Ok(message) => message,
                            Err(error) => {
                                let category = match error.classify() {
                                    serde_json::error::Category::Io => "io",
                                    serde_json::error::Category::Syntax => "syntax",
                                    serde_json::error::Category::Data => "data",
                                    serde_json::error::Category::Eof => "eof",
                                };
                                eprintln!("[Flowent] Invalid JSON: {error}");
                                disconnect(
                                    &shared_child,
                                    &subscriber,
                                    &diagnostics,
                                    &counters,
                                    "invalid_stdout_json",
                                    true,
                                    json!({
                                        "json_error_category": category,
                                        "json_error_line": error.line(),
                                        "json_error_column": error.column(),
                                        "stdout_line_bytes": line.len(),
                                    }),
                                );
                                return;
                            }
                        };
                        counters
                            .stdout_message_count
                            .fetch_add(1, Ordering::Relaxed);
                        if let Err(reason) = forward_message(&subscriber, message) {
                            counters
                                .forward_failure_count
                                .fetch_add(1, Ordering::Relaxed);
                            diagnostics.record(
                                "WARN",
                                "bridge.message.forward_failed",
                                json!({"reason": reason}),
                            );
                            eprintln!("[Flowent] Forward message failed: {reason}");
                        }
                    }
                    CommandEvent::Stderr(line) => {
                        counters.stderr_line_count.fetch_add(1, Ordering::Relaxed);
                        diagnostics.record(
                            "WARN",
                            "bridge.sidecar.stderr",
                            json!({"stderr_line_bytes": line.len()}),
                        );
                        eprint!("[Flowent] {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Error(error) => {
                        eprintln!("[Flowent] {error}");
                        disconnect(
                            &shared_child,
                            &subscriber,
                            &diagnostics,
                            &counters,
                            "command_event_error",
                            true,
                            json!({"os_error_code": os_error_code(&error)}),
                        );
                        return;
                    }
                    CommandEvent::Terminated(payload) => {
                        disconnect(
                            &shared_child,
                            &subscriber,
                            &diagnostics,
                            &counters,
                            "child_terminated",
                            false,
                            json!({
                                "exit_code": payload.code,
                                "signal": payload.signal,
                            }),
                        );
                        return;
                    }
                    _ => {}
                }
            }
            disconnect(
                &shared_child,
                &subscriber,
                &diagnostics,
                &counters,
                "event_stream_closed",
                true,
                json!({}),
            );
        });

        Ok(())
    }

    pub fn send(&self, message: Value) -> Result<(), String> {
        let request_id = diagnostic_request_id(&message);
        let method = diagnostic_method(&message);
        let encoded = match encode_message(&message) {
            Ok(encoded) => encoded,
            Err(error) => {
                self.diagnostics.record(
                    "ERROR",
                    "bridge.request.write_failed",
                    json!({
                        "reason": "encoding_failed",
                        "request_id": request_id,
                        "method": method,
                    }),
                );
                return Err(error);
            }
        };
        let mut child = match self.child.lock() {
            Ok(child) => child,
            Err(_) => {
                self.diagnostics.record(
                    "ERROR",
                    "bridge.request.write_failed",
                    json!({
                        "reason": "child_lock_poisoned",
                        "request_id": request_id,
                        "method": method,
                    }),
                );
                return Err("Flowent child lock poisoned".to_string());
            }
        };
        let Some(process) = child.as_mut() else {
            if method != "organization.get" {
                self.diagnostics.record(
                    "WARN",
                    "bridge.request.rejected",
                    json!({
                        "reason": "not_running",
                        "request_id": request_id,
                        "method": method,
                    }),
                );
            }
            return Err("Flowent is not running".to_string());
        };
        let result = process.write(&encoded);
        drop(child);
        match result {
            Ok(()) => {
                self.counters.record_request(request_id, method);
                if method != "organization.get" {
                    self.diagnostics.record(
                        "INFO",
                        "bridge.request.sent",
                        json!({
                            "request_id": request_id,
                            "method": method,
                            "request_bytes": encoded.len(),
                        }),
                    );
                }
                Ok(())
            }
            Err(error) => {
                let detail = error.to_string();
                self.diagnostics.record(
                    "ERROR",
                    "bridge.request.write_failed",
                    json!({
                        "reason": "pipe_write_failed",
                        "request_id": request_id,
                        "method": method,
                        "request_bytes": encoded.len(),
                        "os_error_code": os_error_code(&detail),
                    }),
                );
                disconnect(
                    &self.child,
                    &self.subscriber,
                    &self.diagnostics,
                    &self.counters,
                    "pipe_write_failed",
                    true,
                    json!({
                        "request_id": request_id,
                        "method": method,
                        "os_error_code": os_error_code(&detail),
                    }),
                );
                Err(format!("Write Flowent message: {error}"))
            }
        }
    }

    pub fn subscribe(&self, channel: Channel<Value>) -> Result<(), String> {
        let child = self.child.lock().map_err(|_| {
            self.diagnostics.record(
                "ERROR",
                "bridge.subscription.failed",
                json!({"reason": "child_lock_poisoned"}),
            );
            "Flowent child lock poisoned".to_string()
        })?;
        if child.is_none() {
            self.diagnostics.record(
                "WARN",
                "bridge.subscription.failed",
                json!({"reason": "not_running"}),
            );
            return Err("Flowent is not running".to_string());
        }
        drop(child);
        *self.subscriber.lock().map_err(|_| {
            self.diagnostics.record(
                "ERROR",
                "bridge.subscription.failed",
                json!({"reason": "subscriber_lock_poisoned"}),
            );
            "Flowent subscriber lock poisoned".to_string()
        })? = Some(channel);
        self.diagnostics
            .record("INFO", "bridge.subscription.started", json!({}));
        Ok(())
    }

    pub fn stop(&self) {
        let child_running = self
            .child
            .lock()
            .map(|child| child.is_some())
            .unwrap_or(false);
        self.counters
            .shutdown_requested
            .store(true, Ordering::Relaxed);
        self.diagnostics.record(
            "INFO",
            "bridge.stop.requested",
            json!({"child_running": child_running}),
        );
        let _ = self.send(json!({
            "id": SHUTDOWN_ID,
            "method": "system.shutdown",
            "params": {},
        }));

        let deadline = Instant::now() + Duration::from_secs(25);
        while Instant::now() < deadline {
            if self.child.lock().map_or(true, |child| child.is_none()) {
                self.diagnostics.record(
                    "INFO",
                    "bridge.stop.completed",
                    json!({"timed_out": false}),
                );
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        disconnect(
            &self.child,
            &self.subscriber,
            &self.diagnostics,
            &self.counters,
            "shutdown_timeout",
            true,
            json!({"timeout_ms": 25_000}),
        );
        self.diagnostics
            .record("ERROR", "bridge.stop.completed", json!({"timed_out": true}));
    }
}

fn encode_message(message: &Value) -> Result<Vec<u8>, String> {
    let mut encoded =
        serde_json::to_vec(message).map_err(|error| format!("Encode Flowent message: {error}"))?;
    encoded.push(b'\n');
    Ok(encoded)
}

fn diagnostic_request_id(message: &Value) -> Option<u64> {
    message.get("id").and_then(Value::as_u64)
}

fn diagnostic_method(message: &Value) -> &'static str {
    match message.get("method").and_then(Value::as_str) {
        Some("organization.get") => "organization.get",
        Some("organization.create_agent") => "organization.create_agent",
        Some("organization.delete_agent") => "organization.delete_agent",
        Some("organization.pause_agent") => "organization.pause_agent",
        Some("organization.resume_agent") => "organization.resume_agent",
        Some("agent.history.get") => "agent.history.get",
        Some("discussion.create") => "discussion.create",
        Some("discussion.delete") => "discussion.delete",
        Some("discussion.send") => "discussion.send",
        Some("settings.get_model") => "settings.get_model",
        Some("settings.update_model") => "settings.update_model",
        Some("settings.get_observability") => "settings.get_observability",
        Some("settings.update_observability") => "settings.update_observability",
        Some("system.shutdown") => "system.shutdown",
        _ => "unknown",
    }
}

fn forward_message(subscriber: &SharedSubscriber, message: Value) -> Result<(), &'static str> {
    subscriber
        .lock()
        .map_err(|_| "subscriber_lock_poisoned")?
        .as_ref()
        .ok_or("not_subscribed")?
        .send(message)
        .map_err(|_| "channel_send_failed")
}

fn disconnect(
    child: &SharedChild,
    subscriber: &SharedSubscriber,
    diagnostics: &SharedDiagnostics,
    counters: &SharedCounters,
    reason: &'static str,
    kill: bool,
    details: Value,
) {
    let subscriber_cleared = match subscriber.lock() {
        Ok(mut subscriber) => {
            *subscriber = None;
            true
        }
        Err(_) => false,
    };
    let process = match child.lock() {
        Ok(mut child) => child.take(),
        Err(_) => {
            diagnostics.record(
                "ERROR",
                "bridge.disconnect.failed",
                json!({
                    "reason": reason,
                    "failure_reason": "child_lock_poisoned",
                    "subscriber_cleared": subscriber_cleared,
                }),
            );
            return;
        }
    };
    let Some(process) = process else {
        diagnostics.record(
            "WARN",
            "bridge.disconnect.ignored",
            json!({
                "reason": reason,
                "child_registered": false,
                "subscriber_cleared": subscriber_cleared,
            }),
        );
        return;
    };
    let child_pid = process.pid();
    let (kill_attempted, kill_succeeded) = if kill {
        (true, process.kill().is_ok())
    } else {
        (false, false)
    };
    let mut fields = match details {
        Value::Object(fields) => fields,
        _ => serde_json::Map::new(),
    };
    if let Value::Object(snapshot) = counters.snapshot() {
        fields.extend(snapshot);
    }
    fields.insert("reason".into(), json!(reason));
    fields.insert("child_pid".into(), json!(child_pid));
    fields.insert("kill_attempted".into(), json!(kill_attempted));
    fields.insert("kill_succeeded".into(), json!(kill_succeeded));
    fields.insert("subscriber_cleared".into(), json!(subscriber_cleared));
    let level = disconnect_level(
        reason,
        counters.shutdown_requested.load(Ordering::Relaxed),
        &fields,
    );
    diagnostics.record(level, "bridge.disconnected", Value::Object(fields));
}

fn disconnect_level(
    reason: &str,
    shutdown_requested: bool,
    details: &serde_json::Map<String, Value>,
) -> &'static str {
    if reason == "child_terminated"
        && shutdown_requested
        && details.get("exit_code").and_then(Value::as_i64) == Some(0)
        && details.get("signal").is_none_or(Value::is_null)
    {
        "INFO"
    } else {
        "ERROR"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::InvokeResponseBody;

    #[test]
    fn selects_development_python_only_for_tauri_dev() {
        let python = PathBuf::from("/tmp/flowent-python");

        assert_eq!(
            resolve_flowent_executable(true, Some(python.clone())).unwrap(),
            FlowentExecutable::Development(python)
        );
        assert!(resolve_flowent_executable(true, None).is_err());
        assert_eq!(
            resolve_flowent_executable(false, Some(PathBuf::from("ignored"))).unwrap(),
            FlowentExecutable::Sidecar
        );
    }

    #[test]
    fn logs_only_known_request_method_names() {
        assert_eq!(
            diagnostic_method(&json!({"method": "discussion.send"})),
            "discussion.send"
        );
        assert_eq!(
            diagnostic_method(&json!({"method": "private request content"})),
            "unknown"
        );
    }

    #[test]
    fn classifies_only_requested_zero_exit_as_normal() {
        let normal = json!({"exit_code": 0, "signal": null});
        let signaled = json!({"exit_code": null, "signal": 15});
        let normal = normal.as_object().unwrap();
        let signaled = signaled.as_object().unwrap();

        assert_eq!(disconnect_level("child_terminated", true, normal), "INFO");
        assert_eq!(disconnect_level("child_terminated", false, normal), "ERROR");
        assert_eq!(
            disconnect_level("child_terminated", true, signaled),
            "ERROR"
        );
    }

    #[test]
    fn forwards_json_to_the_subscriber() {
        let messages = Arc::new(Mutex::new(Vec::<Value>::new()));
        let received = Arc::clone(&messages);
        let channel = Channel::new(move |body| {
            let InvokeResponseBody::Json(json) = body else {
                panic!("expected JSON channel message");
            };
            received.lock().unwrap().push(serde_json::from_str(&json)?);
            Ok(())
        });
        let subscriber = Arc::new(Mutex::new(Some(channel)));

        forward_message(&subscriber, json!({"id": 1, "result": null})).unwrap();

        assert_eq!(
            *messages.lock().unwrap(),
            vec![json!({"id": 1, "result": null})]
        );
    }
}
