use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use anyhow::{Context, Result, anyhow};
use serde_json::{Value, json};
use tauri::{
    AppHandle,
    async_runtime::{Sender, channel},
};
use tauri_plugin_shell::{
    ShellExt,
    process::{CommandChild, CommandEvent},
};

type PendingResponse = Result<Value, String>;
type PendingSender = Sender<PendingResponse>;
type SharedBridge = Arc<Mutex<BridgeState>>;

struct BridgeState {
    child: Option<CommandChild>,
    failure: Option<String>,
    pending: HashMap<u64, PendingSender>,
}

impl Default for BridgeState {
    fn default() -> Self {
        Self {
            child: None,
            failure: Some("Sidecar is not running".to_string()),
            pending: HashMap::new(),
        }
    }
}

pub struct Sidecar {
    bridge: SharedBridge,
    next_request_id: AtomicU64,
    working_directory: PathBuf,
}

impl Default for Sidecar {
    fn default() -> Self {
        Self {
            bridge: Arc::new(Mutex::new(BridgeState::default())),
            next_request_id: AtomicU64::new(1),
            working_directory: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        }
    }
}

impl Sidecar {
    pub fn start(&self, app: &AppHandle) -> Result<()> {
        let (mut events, child) = app
            .shell()
            .sidecar("flowent-agent")
            .context("create sidecar command")?
            .current_dir(&self.working_directory)
            .spawn()
            .context("start sidecar")?;

        {
            let mut bridge = self
                .bridge
                .lock()
                .map_err(|_| anyhow!("sidecar bridge lock poisoned"))?;
            bridge.child = Some(child);
            bridge.failure = None;
        }

        let bridge = Arc::clone(&self.bridge);
        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                if !handle_event(&bridge, event) {
                    return;
                }
            }
            fail_bridge(&bridge, "Sidecar event stream closed");
        });

        Ok(())
    }

    pub async fn request(&self, method: String, params: Value) -> PendingResponse {
        let request_id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        let request = json!({
            "id": request_id,
            "method": method,
            "params": params,
        });
        let mut encoded = serde_json::to_vec(&request)
            .map_err(|error| format!("Encode Sidecar request: {error}"))?;
        encoded.push(b'\n');

        let (sender, mut receiver) = channel(1);
        let write_result = {
            let mut bridge = self
                .bridge
                .lock()
                .map_err(|_| "Sidecar bridge lock poisoned".to_string())?;
            if let Some(error) = &bridge.failure {
                return Err(error.clone());
            }
            bridge.pending.insert(request_id, sender);
            bridge
                .child
                .as_mut()
                .ok_or_else(|| "Sidecar is not running".to_string())?
                .write(&encoded)
                .map_err(|error| format!("Write Sidecar request: {error}"))
        };

        if let Err(error) = write_result {
            fail_bridge(&self.bridge, &error);
            return Err(error);
        }

        receiver
            .recv()
            .await
            .ok_or_else(|| "Sidecar response channel closed".to_string())?
    }

    pub fn stop(&self) {
        fail_bridge(&self.bridge, "Sidecar stopped");
    }
}

fn handle_event(bridge: &SharedBridge, event: CommandEvent) -> bool {
    match event {
        CommandEvent::Stdout(line) => {
            if let Err(error) = deliver_response(bridge, &line) {
                let message = error.to_string();
                eprintln!("[Sidecar] {message}");
                fail_bridge(bridge, &message);
                return false;
            }
        }
        CommandEvent::Stderr(line) => {
            eprint!("[Sidecar] {}", String::from_utf8_lossy(&line));
        }
        CommandEvent::Error(error) => {
            let message = format!("Sidecar event error: {error}");
            eprintln!("[Sidecar] {message}");
            fail_bridge(bridge, &message);
            return false;
        }
        CommandEvent::Terminated(_) => {
            fail_bridge(bridge, "Sidecar stopped");
            return false;
        }
        _ => {}
    }
    true
}

fn deliver_response(bridge: &SharedBridge, line: &[u8]) -> Result<()> {
    let (request_id, response) = parse_response(line)?;
    let sender = bridge
        .lock()
        .map_err(|_| anyhow!("sidecar bridge lock poisoned"))?
        .pending
        .remove(&request_id)
        .with_context(|| format!("unknown response id: {request_id}"))?;
    sender
        .try_send(response)
        .map_err(|error| anyhow!("deliver Sidecar response: {error}"))?;
    Ok(())
}

fn parse_response(line: &[u8]) -> Result<(u64, PendingResponse)> {
    let value: Value = serde_json::from_slice(line).context("invalid response JSON")?;
    let envelope = value.as_object().context("response must be an object")?;
    let request_id = envelope
        .get("id")
        .and_then(Value::as_u64)
        .filter(|request_id| *request_id > 0)
        .context("response id must be a positive integer")?;
    let result = envelope.get("result");
    let error = envelope.get("error");

    match (result, error) {
        (Some(result), None) => Ok((request_id, Ok(result.clone()))),
        (None, Some(error)) => {
            let message = error
                .as_object()
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .context("response error message must be a string")?;
            Ok((request_id, Err(message.to_string())))
        }
        _ => Err(anyhow!(
            "response must contain exactly one of result or error"
        )),
    }
}

fn fail_bridge(bridge: &SharedBridge, message: &str) {
    let (child, senders) = match bridge.lock() {
        Ok(mut state) => {
            if state.failure.is_none() {
                state.failure = Some(message.to_string());
            }
            let child = state.child.take();
            let senders: Vec<PendingSender> =
                state.pending.drain().map(|(_, sender)| sender).collect();
            (child, senders)
        }
        Err(_) => return,
    };

    if let Some(child) = child {
        let _ = child.kill();
    }
    for sender in senders {
        let _ = sender.try_send(Err(message.to_string()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_bridge() -> SharedBridge {
        Arc::new(Mutex::new(BridgeState {
            child: None,
            failure: None,
            pending: HashMap::new(),
        }))
    }

    fn add_pending(
        bridge: &SharedBridge,
        request_id: u64,
    ) -> tauri::async_runtime::Receiver<PendingResponse> {
        let (sender, receiver) = channel(1);
        bridge.lock().unwrap().pending.insert(request_id, sender);
        receiver
    }

    #[test]
    fn parses_successful_response() {
        let (request_id, response) =
            parse_response(br#"{"id":7,"result":{"organization":{"id":1}}}"#).unwrap();

        assert_eq!(request_id, 7);
        assert_eq!(response.unwrap()["organization"]["id"], 1);
    }

    #[test]
    fn parses_error_response() {
        let (request_id, response) = parse_response(
            br#"{"id":9,"error":{"code":"invalid_name","message":"Agent name is required"}}"#,
        )
        .unwrap();

        assert_eq!(request_id, 9);
        assert_eq!(response.unwrap_err(), "Agent name is required");
    }

    #[test]
    fn accepts_arbitrary_json_result() {
        let (_, response) = parse_response(br#"{"id":1,"result":null}"#).unwrap();
        assert_eq!(response.unwrap(), Value::Null);
    }

    #[test]
    fn rejects_invalid_response_envelopes() {
        for response in [
            br#"{"id":0,"result":{}}"#.as_slice(),
            br#"{"id":1}"#.as_slice(),
            br#"{"id":1,"result":{},"error":{"message":"no"}}"#.as_slice(),
            br#"{"id":1,"error":{}}"#.as_slice(),
        ] {
            assert!(parse_response(response).is_err());
        }
    }

    #[test]
    fn malformed_envelope_fails_pending_and_closes_bridge() {
        let bridge = open_bridge();
        let mut receiver = add_pending(&bridge, 1);

        assert!(!handle_event(
            &bridge,
            CommandEvent::Stdout(br#"{"id":1,"result":{},"error":{}}"#.to_vec())
        ));
        assert!(receiver.try_recv().unwrap().is_err());
        assert!(bridge.lock().unwrap().failure.is_some());
    }

    #[test]
    fn malformed_output_fails_pending_and_closes_bridge() {
        let bridge = open_bridge();
        let mut receiver = add_pending(&bridge, 1);

        assert!(!handle_event(
            &bridge,
            CommandEvent::Stdout(b"not-json".to_vec())
        ));
        assert!(receiver.try_recv().unwrap().is_err());
        assert!(bridge.lock().unwrap().failure.is_some());
    }

    #[test]
    fn unknown_response_id_fails_pending_and_closes_bridge() {
        let bridge = open_bridge();
        let mut receiver = add_pending(&bridge, 1);

        assert!(!handle_event(
            &bridge,
            CommandEvent::Stdout(br#"{"id":2,"result":{}}"#.to_vec())
        ));
        assert!(receiver.try_recv().unwrap().is_err());
        assert!(bridge.lock().unwrap().failure.is_some());
    }

    #[test]
    fn command_error_fails_pending_and_closes_bridge() {
        let bridge = open_bridge();
        let mut receiver = add_pending(&bridge, 1);

        assert!(!handle_event(
            &bridge,
            CommandEvent::Error("read failed".to_string())
        ));
        assert!(receiver.try_recv().unwrap().is_err());
        assert!(bridge.lock().unwrap().failure.is_some());
    }

    #[test]
    fn event_stream_close_fails_pending_and_closes_bridge() {
        let bridge = open_bridge();
        let mut receiver = add_pending(&bridge, 1);

        fail_bridge(&bridge, "Sidecar event stream closed");

        assert_eq!(
            receiver.try_recv().unwrap().unwrap_err(),
            "Sidecar event stream closed"
        );
        assert_eq!(
            bridge.lock().unwrap().failure.as_deref(),
            Some("Sidecar event stream closed")
        );
    }

    #[test]
    fn request_after_close_fails_immediately() {
        let sidecar = Sidecar::default();

        let result = tauri::async_runtime::block_on(
            sidecar.request("organization.get".to_string(), json!({})),
        );

        assert_eq!(result.unwrap_err(), "Sidecar is not running");
    }

    #[test]
    fn stopping_an_idle_sidecar_is_safe() {
        Sidecar::default().stop();
    }
}
