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

#[cfg(feature = "desktop-e2e")]
const DATA_DIRECTORY_ENV: &str = "FLOWENT_DATA_DIR";
#[cfg(not(feature = "desktop-e2e"))]
const SIDECAR_NAME: &str = "flowent-agent";
#[cfg(feature = "desktop-e2e")]
const SIDECAR_NAME: &str = "flowent-agent-e2e";
const SHUTDOWN_ID: u64 = u64::MAX;

type SharedChild = Arc<Mutex<Option<CommandChild>>>;
type SharedSubscriber = Arc<Mutex<Option<Channel<Value>>>>;

pub struct Sidecar {
    child: SharedChild,
    subscriber: SharedSubscriber,
    working_directory: PathBuf,
}

impl Default for Sidecar {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            subscriber: Arc::new(Mutex::new(None)),
            working_directory: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        }
    }
}

impl Sidecar {
    pub fn start(&self, app: &AppHandle) -> Result<()> {
        let command = app
            .shell()
            .sidecar(SIDECAR_NAME)
            .context("create sidecar command")?
            .env_clear()
            .envs(std::env::vars_os())
            .current_dir(&self.working_directory);
        #[cfg(feature = "desktop-e2e")]
        let command = command.env(
            DATA_DIRECTORY_ENV,
            self.working_directory.join("artifacts/desktop/e2e-state"),
        );
        let (mut events, child) = command.spawn().context("start sidecar")?;
        *self
            .child
            .lock()
            .map_err(|_| anyhow::anyhow!("sidecar child lock poisoned"))? = Some(child);

        let shared_child = Arc::clone(&self.child);
        let subscriber = Arc::clone(&self.subscriber);
        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let message = match serde_json::from_slice(&line) {
                            Ok(message) => message,
                            Err(error) => {
                                eprintln!("[Sidecar] Invalid JSON: {error}");
                                disconnect(&shared_child, &subscriber, true);
                                return;
                            }
                        };
                        if let Err(error) = forward_message(&subscriber, message) {
                            eprintln!("[Sidecar] {error}");
                        }
                    }
                    CommandEvent::Stderr(line) => {
                        eprint!("[Sidecar] {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Error(error) => {
                        eprintln!("[Sidecar] {error}");
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
            .map_err(|_| "Sidecar child lock poisoned".to_string())?
            .as_mut()
            .ok_or_else(|| "Sidecar is not running".to_string())?
            .write(&encoded)
            .map_err(|error| format!("Write Sidecar message: {error}"));
        if result.is_err() {
            disconnect(&self.child, &self.subscriber, true);
        }
        result
    }

    pub fn subscribe(&self, channel: Channel<Value>) -> Result<(), String> {
        if self
            .child
            .lock()
            .map_err(|_| "Sidecar child lock poisoned".to_string())?
            .is_none()
        {
            return Err("Sidecar is not running".to_string());
        }
        *self
            .subscriber
            .lock()
            .map_err(|_| "Sidecar subscriber lock poisoned".to_string())? = Some(channel);
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
        serde_json::to_vec(message).map_err(|error| format!("Encode Sidecar message: {error}"))?;
    encoded.push(b'\n');
    Ok(encoded)
}

fn forward_message(subscriber: &SharedSubscriber, message: Value) -> Result<(), String> {
    subscriber
        .lock()
        .map_err(|_| "Sidecar subscriber lock poisoned".to_string())?
        .as_ref()
        .ok_or_else(|| "Sidecar is not subscribed".to_string())?
        .send(message)
        .map_err(|error| format!("Forward Sidecar message: {error}"))
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
