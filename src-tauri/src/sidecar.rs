use std::{
    collections::{BTreeMap, VecDeque},
    fs,
    sync::{Arc, Mutex},
};

use anyhow::{Context, Result, anyhow};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, ipc::Channel};
use tauri_plugin_shell::{
    ShellExt,
    process::{CommandChild, CommandEvent},
};

use crate::secrets;

type OutboundMessages = Arc<Mutex<Outbound>>;

#[derive(Default)]
struct Outbound {
    channel: Option<Channel<Value>>,
    pending: VecDeque<Value>,
    approvals: BTreeMap<String, Value>,
}

impl Outbound {
    fn send(&mut self, message: Value) {
        if matches!(
            message.get("method").and_then(Value::as_str),
            Some("turn/completed" | "turn/failed")
        ) {
            self.approvals.clear();
        }
        if let Some(id) = approval_id(&message) {
            self.approvals.insert(id, message.clone());
            if let Some(channel) = self.channel.as_ref()
                && channel.send(message).is_err()
            {
                self.channel = None;
            }
            return;
        }
        if let Some(channel) = self.channel.as_ref() {
            if channel.send(message.clone()).is_ok() {
                return;
            }
            self.channel = None;
        }
        self.pending.push_back(message);
    }

    fn subscribe(&mut self, channel: Channel<Value>) -> Result<()> {
        while let Some(message) = self.pending.pop_front() {
            if let Err(error) = channel.send(message.clone()) {
                self.pending.push_front(message);
                return Err(error.into());
            }
        }
        for message in self.approvals.values() {
            channel.send(message.clone())?;
        }
        self.channel = Some(channel);
        Ok(())
    }

    fn resolve(&mut self, message: &Value) {
        if message.get("method").is_none()
            && (message.get("result").is_some() || message.get("error").is_some())
            && let Some(id) = message.get("id").and_then(Value::as_str)
        {
            self.approvals.remove(id);
        }
    }
}

#[derive(Default)]
pub struct Sidecar {
    child: Arc<Mutex<Option<CommandChild>>>,
    outbound: OutboundMessages,
}

impl Sidecar {
    pub fn start(&self, app: &AppHandle) -> Result<()> {
        let data_dir = app
            .path()
            .app_data_dir()
            .context("resolve app data directory")?;
        fs::create_dir_all(&data_dir).context("create app data directory")?;
        let (mut events, child) = app
            .shell()
            .sidecar("flowent-agent")
            .context("create sidecar command")?
            .env("FLOWENT_DATA_DIR", data_dir)
            .spawn()
            .context("start sidecar")?;
        *self
            .child
            .lock()
            .map_err(|_| anyhow!("sidecar child lock poisoned"))? = Some(child);

        let child = Arc::clone(&self.child);
        let outbound = Arc::clone(&self.outbound);

        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        if let Err(error) = dispatch(&child, &outbound, &line) {
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
            clear_process(&child);
        });

        Ok(())
    }

    pub fn send(&self, message: &Value) -> Result<()> {
        write(&self.child, message)?;
        self.outbound
            .lock()
            .map_err(|_| anyhow!("sidecar outbound lock poisoned"))?
            .resolve(message);
        Ok(())
    }

    pub fn subscribe(&self, channel: Channel<Value>) -> Result<()> {
        self.outbound
            .lock()
            .map_err(|_| anyhow!("sidecar outbound lock poisoned"))?
            .subscribe(channel)
    }

    pub fn stop(&self) {
        if let Some(child) = self.child.lock().expect("sidecar child lock").take() {
            let _ = child.kill();
        }
        if let Ok(mut outbound) = self.outbound.lock() {
            outbound.channel = None;
            outbound.pending.clear();
            outbound.approvals.clear();
        }
    }
}

fn encode(message: &Value) -> Result<Vec<u8>> {
    let mut encoded = serde_json::to_vec(message).context("encode sidecar message")?;
    encoded.push(b'\n');
    Ok(encoded)
}

fn approval_id(message: &Value) -> Option<String> {
    if message.get("method").and_then(Value::as_str) != Some("approval/request") {
        return None;
    }
    message.get("id").and_then(Value::as_str).map(str::to_owned)
}

fn dispatch(
    child: &Arc<Mutex<Option<CommandChild>>>,
    outbound: &OutboundMessages,
    line: &[u8],
) -> Result<()> {
    let message = serde_json::from_slice(line).context("decode sidecar message")?;
    if let Some(response) = internal_response(&message, secrets::get_provider) {
        return write(child, &response);
    }
    let mut outbound = outbound
        .lock()
        .map_err(|_| anyhow!("sidecar outbound lock poisoned"))?;
    outbound.send(message);
    Ok(())
}

fn internal_response<F>(message: &Value, get_secret: F) -> Option<Value>
where
    F: FnOnce(&str) -> Result<Option<String>>,
{
    if message.get("method").and_then(Value::as_str) != Some("providers/secret") {
        return None;
    }

    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let result = message
        .get("params")
        .and_then(|params| params.get("id"))
        .and_then(Value::as_str)
        .context("provider ID is required")
        .and_then(get_secret);
    Some(match result {
        Ok(secret) => json!({"id": id, "result": secret}),
        Err(error) => json!({"id": id, "error": {"message": format!("{error:#}")}}),
    })
}

fn write(child: &Arc<Mutex<Option<CommandChild>>>, message: &Value) -> Result<()> {
    let message = encode(message)?;
    child
        .lock()
        .map_err(|_| anyhow!("sidecar child lock poisoned"))?
        .as_mut()
        .context("sidecar is not running")?
        .write(&message)
        .context("write sidecar message")
}

fn clear_process(child: &Arc<Mutex<Option<CommandChild>>>) {
    if let Ok(mut child) = child.lock() {
        child.take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tauri::ipc::InvokeResponseBody;

    #[test]
    fn encodes_one_json_object_per_line() {
        assert_eq!(
            encode(&json!({"id": "ui-1", "method": "app/info"})).expect("encode message"),
            br#"{"id":"ui-1","method":"app/info"}
"#
        );
    }

    #[test]
    fn forwards_messages_received_before_subscription() {
        let mut outbound = Outbound::default();
        let received = Arc::new(Mutex::new(Vec::<Value>::new()));
        let received_by_channel = Arc::clone(&received);
        let message = json!({"method": "runtime/ready", "params": {}});

        outbound.send(message.clone());

        outbound
            .subscribe(Channel::new(move |body| {
                let InvokeResponseBody::Json(value) = body else {
                    panic!("expected JSON channel payload");
                };
                received_by_channel
                    .lock()
                    .expect("received message lock")
                    .push(serde_json::from_str(&value).expect("decode channel payload"));
                Ok(())
            }))
            .expect("subscribe channel");

        assert_eq!(
            *received.lock().expect("received message lock"),
            vec![message]
        );
    }

    #[test]
    fn handles_provider_secret_requests_internally() {
        let request = json!({
            "id": "desktop-1",
            "method": "providers/secret",
            "params": {"id": "provider-1"}
        });

        let response = internal_response(&request, |provider_id| {
            assert_eq!(provider_id, "provider-1");
            Ok(Some("secret".to_string()))
        });

        assert_eq!(
            response,
            Some(json!({"id": "desktop-1", "result": "secret"}))
        );
        assert!(internal_response(&json!({"method": "runtime/ready"}), |_| Ok(None)).is_none());
    }

    #[test]
    fn replays_unresolved_approval_requests() {
        let mut outbound = Outbound::default();
        let first = Arc::new(Mutex::new(Vec::<Value>::new()));
        let first_channel = Arc::clone(&first);
        outbound
            .subscribe(Channel::new(move |body| {
                let InvokeResponseBody::Json(value) = body else {
                    panic!("expected JSON channel payload");
                };
                first_channel
                    .lock()
                    .expect("first channel lock")
                    .push(serde_json::from_str(&value).expect("decode channel payload"));
                Ok(())
            }))
            .expect("subscribe first channel");
        let request = json!({
            "id": "desktop-1",
            "method": "approval/request",
            "params": {"tool": "run_command"}
        });
        outbound.send(request.clone());

        let second = Arc::new(Mutex::new(Vec::<Value>::new()));
        let second_channel = Arc::clone(&second);
        outbound
            .subscribe(Channel::new(move |body| {
                let InvokeResponseBody::Json(value) = body else {
                    panic!("expected JSON channel payload");
                };
                second_channel
                    .lock()
                    .expect("second channel lock")
                    .push(serde_json::from_str(&value).expect("decode channel payload"));
                Ok(())
            }))
            .expect("subscribe second channel");

        outbound.resolve(&json!({"id": "desktop-1", "result": false}));

        assert_eq!(
            *first.lock().expect("first messages lock"),
            vec![request.clone()]
        );
        assert_eq!(*second.lock().expect("second messages lock"), vec![request]);
        assert!(outbound.approvals.is_empty());

        outbound.send(json!({
            "id": "desktop-2",
            "method": "approval/request",
            "params": {"tool": "run_command"}
        }));
        outbound.send(json!({"method": "turn/failed", "params": {}}));
        assert!(outbound.approvals.is_empty());
    }
}
