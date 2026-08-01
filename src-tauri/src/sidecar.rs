use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_shell::{
    ShellExt,
    process::{CommandChild, CommandEvent},
};
use tokio::{sync::oneshot, time::timeout};

const APP_INFO: &str = "app.info";
type PendingResponses = Arc<Mutex<HashMap<String, oneshot::Sender<IncomingMessage>>>>;

#[derive(Debug, Deserialize, PartialEq, Serialize)]
pub struct AppInfo {
    name: String,
    version: String,
}

#[derive(Debug, Deserialize)]
struct IncomingMessage {
    id: Option<String>,
    #[serde(rename = "type")]
    message_type: String,
    data: Value,
}

#[derive(Serialize)]
struct OutgoingRequest<'a> {
    id: &'a str,
    #[serde(rename = "type")]
    message_type: &'static str,
}

pub struct Sidecar {
    child: Arc<Mutex<Option<CommandChild>>>,
    pending: PendingResponses,
    next_id: AtomicU64,
}

impl Default for Sidecar {
    fn default() -> Self {
        Self {
            child: Arc::default(),
            pending: Arc::default(),
            next_id: AtomicU64::new(1),
        }
    }
}

impl Sidecar {
    pub fn start(&self, app: &AppHandle) -> Result<(), String> {
        let (mut events, child) = app
            .shell()
            .sidecar("flowent-agent")
            .map_err(|error| error.to_string())?
            .spawn()
            .map_err(|error| error.to_string())?;
        *self.child.lock().map_err(|error| error.to_string())? = Some(child);

        let child = Arc::clone(&self.child);
        let pending = Arc::clone(&self.pending);

        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        if let Err(error) = dispatch_response(&pending, &line) {
                            eprintln!("flowent-agent: {error}");
                        }
                    }
                    CommandEvent::Stderr(line) => {
                        eprintln!("flowent-agent: {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Error(error) => eprintln!("flowent-agent: {error}"),
                    CommandEvent::Terminated(_) => break,
                    _ => {}
                }
            }
            clear_process(&child, &pending);
        });

        Ok(())
    }

    pub async fn app_info(&self) -> Result<AppInfo, String> {
        let id = format!("app-info-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let request = OutgoingRequest {
            id: &id,
            message_type: APP_INFO,
        };
        let mut message = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
        message.push(b'\n');

        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .map_err(|error| error.to_string())?
            .insert(id.clone(), sender);

        let write_result = (|| {
            self.child
                .lock()
                .map_err(|error| error.to_string())?
                .as_mut()
                .ok_or_else(|| "sidecar is not running".to_owned())?
                .write(&message)
                .map_err(|error| error.to_string())
        })();
        if let Err(error) = write_result {
            self.remove_pending(&id);
            return Err(error);
        }

        let response = match timeout(Duration::from_secs(5), receiver).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => return Err("sidecar stopped before responding".to_owned()),
            Err(_) => {
                self.remove_pending(&id);
                return Err("sidecar response timed out".to_owned());
            }
        };

        app_info_from_response(response, &id)
    }

    pub fn stop(&self) {
        if let Some(child) = self.child.lock().expect("sidecar child lock").take() {
            let _ = child.kill();
        }
        self.pending
            .lock()
            .expect("sidecar pending response lock")
            .clear();
    }

    fn remove_pending(&self, id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(id);
        }
    }
}

fn dispatch_response(pending: &PendingResponses, line: &[u8]) -> Result<(), String> {
    let message: IncomingMessage =
        serde_json::from_slice(line).map_err(|error| error.to_string())?;
    let Some(id) = message.id.as_ref() else {
        return Ok(());
    };
    let sender = pending
        .lock()
        .map_err(|error| error.to_string())?
        .remove(id);
    if let Some(sender) = sender {
        let _ = sender.send(message);
    }
    Ok(())
}

fn app_info_from_response(response: IncomingMessage, request_id: &str) -> Result<AppInfo, String> {
    if response.message_type != APP_INFO || response.id.as_deref() != Some(request_id) {
        return Err("invalid sidecar response".to_owned());
    }
    serde_json::from_value(response.data).map_err(|error| error.to_string())
}

fn clear_process(child: &Arc<Mutex<Option<CommandChild>>>, pending: &PendingResponses) {
    if let Ok(mut child) = child.lock() {
        child.take();
    }
    if let Ok(mut pending) = pending.lock() {
        pending.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatches_app_info_response() {
        let pending = PendingResponses::default();
        let (sender, mut receiver) = oneshot::channel();
        pending
            .lock()
            .expect("pending response lock")
            .insert("app-info-1".to_owned(), sender);

        dispatch_response(
            &pending,
            br#"{"id":"app-info-1","type":"app.info","data":{"name":"Flowent","version":"0.0.0"}}"#,
        )
        .expect("dispatch response");

        let response = receiver.try_recv().expect("receive response");
        assert_eq!(
            app_info_from_response(response, "app-info-1").expect("app info"),
            AppInfo {
                name: "Flowent".to_owned(),
                version: "0.0.0".to_owned(),
            }
        );
    }
}
