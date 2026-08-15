use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

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

pub struct FlowentProcess {
    child: SharedChild,
    subscriber: SharedSubscriber,
    working_directory: PathBuf,
}

impl Default for FlowentProcess {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            subscriber: Arc::new(Mutex::new(None)),
            working_directory: std::env::var_os("FLOWENT_WORKING_DIRECTORY")
                .map(PathBuf::from)
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))),
        }
    }
}

impl FlowentProcess {
    pub fn start(&self, app: &AppHandle) -> Result<()> {
        let shell = app.shell();
        let executable = resolve_flowent_executable(
            tauri::is_dev(),
            std::env::var_os(FLOWENT_DEVELOPMENT_PYTHON).map(PathBuf::from),
        )?;
        let command = match executable {
            FlowentExecutable::Development(python) => shell.command(python).args(["-m", "flowent"]),
            FlowentExecutable::Sidecar => shell
                .sidecar(FLOWENT_BINARY)
                .context("create Flowent sidecar command")?,
        }
        .env_clear()
        .envs(std::env::vars_os())
        .current_dir(&self.working_directory);
        let (mut events, child) = command.spawn().context("start Flowent")?;
        *self
            .child
            .lock()
            .map_err(|_| anyhow::anyhow!("Flowent child lock poisoned"))? = Some(child);

        let shared_child = Arc::clone(&self.child);
        let subscriber = Arc::clone(&self.subscriber);
        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let message = match serde_json::from_slice(&line) {
                            Ok(message) => message,
                            Err(error) => {
                                eprintln!("[Flowent] Invalid JSON: {error}");
                                disconnect(&shared_child, &subscriber, true);
                                return;
                            }
                        };
                        if let Err(error) = forward_message(&subscriber, message) {
                            eprintln!("[Flowent] {error}");
                        }
                    }
                    CommandEvent::Stderr(line) => {
                        eprint!("[Flowent] {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Error(error) => {
                        eprintln!("[Flowent] {error}");
                        disconnect(&shared_child, &subscriber, true);
                        return;
                    }
                    CommandEvent::Terminated(_) => {
                        disconnect(&shared_child, &subscriber, false);
                        return;
                    }
                    _ => {}
                }
            }
            disconnect(&shared_child, &subscriber, true);
        });

        Ok(())
    }

    pub fn send(&self, message: Value) -> Result<(), String> {
        let encoded = encode_message(&message)?;
        let result = self
            .child
            .lock()
            .map_err(|_| "Flowent child lock poisoned".to_string())?
            .as_mut()
            .ok_or_else(|| "Flowent is not running".to_string())?
            .write(&encoded)
            .map_err(|error| format!("Write Flowent message: {error}"));
        if result.is_err() {
            disconnect(&self.child, &self.subscriber, true);
        }
        result
    }

    pub fn subscribe(&self, channel: Channel<Value>) -> Result<(), String> {
        if self
            .child
            .lock()
            .map_err(|_| "Flowent child lock poisoned".to_string())?
            .is_none()
        {
            return Err("Flowent is not running".to_string());
        }
        *self
            .subscriber
            .lock()
            .map_err(|_| "Flowent subscriber lock poisoned".to_string())? = Some(channel);
        Ok(())
    }

    pub fn stop(&self) {
        let _ = self.send(json!({
            "id": SHUTDOWN_ID,
            "method": "system.shutdown",
            "params": {},
        }));

        let deadline = Instant::now() + Duration::from_secs(25);
        while Instant::now() < deadline {
            if self.child.lock().map_or(true, |child| child.is_none()) {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        disconnect(&self.child, &self.subscriber, true);
    }
}

fn encode_message(message: &Value) -> Result<Vec<u8>, String> {
    let mut encoded =
        serde_json::to_vec(message).map_err(|error| format!("Encode Flowent message: {error}"))?;
    encoded.push(b'\n');
    Ok(encoded)
}

fn forward_message(subscriber: &SharedSubscriber, message: Value) -> Result<(), String> {
    subscriber
        .lock()
        .map_err(|_| "Flowent subscriber lock poisoned".to_string())?
        .as_ref()
        .ok_or_else(|| "Flowent is not subscribed".to_string())?
        .send(message)
        .map_err(|error| format!("Forward Flowent message: {error}"))
}

fn disconnect(child: &SharedChild, subscriber: &SharedSubscriber, kill: bool) {
    if let Ok(mut subscriber) = subscriber.lock() {
        *subscriber = None;
    }
    let child = child.lock().ok().and_then(|mut child| child.take());
    if kill && let Some(child) = child {
        let _ = child.kill();
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
