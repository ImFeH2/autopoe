use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use serde_json::Value;
use tauri::{AppHandle, ipc::Channel};
use tauri_plugin_shell::{
    ShellExt,
    process::{CommandChild, CommandEvent},
};

type OutboundMessages = Arc<Mutex<Outbound>>;

#[derive(Default)]
struct Outbound {
    channel: Option<Channel<Value>>,
    pending: VecDeque<Value>,
}

impl Outbound {
    fn send(&mut self, message: Value) {
        if let Some(channel) = self.channel.as_ref() {
            if channel.send(message.clone()).is_ok() {
                return;
            }
            self.channel = None;
        }
        self.pending.push_back(message);
    }

    fn subscribe(&mut self, channel: Channel<Value>) -> Result<(), String> {
        while let Some(message) = self.pending.pop_front() {
            if let Err(error) = channel.send(message.clone()) {
                self.pending.push_front(message);
                return Err(error.to_string());
            }
        }
        self.channel = Some(channel);
        Ok(())
    }
}

#[derive(Default)]
pub struct Sidecar {
    child: Arc<Mutex<Option<CommandChild>>>,
    outbound: OutboundMessages,
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
        let outbound = Arc::clone(&self.outbound);

        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        if let Err(error) = dispatch(&outbound, &line) {
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

    pub fn send(&self, message: &Value) -> Result<(), String> {
        let message = encode(message)?;
        self.child
            .lock()
            .map_err(|error| error.to_string())?
            .as_mut()
            .ok_or_else(|| "sidecar is not running".to_owned())?
            .write(&message)
            .map_err(|error| error.to_string())
    }

    pub fn subscribe(&self, channel: Channel<Value>) -> Result<(), String> {
        self.outbound
            .lock()
            .map_err(|error| error.to_string())?
            .subscribe(channel)
    }

    pub fn stop(&self) {
        if let Some(child) = self.child.lock().expect("sidecar child lock").take() {
            let _ = child.kill();
        }
        if let Ok(mut outbound) = self.outbound.lock() {
            outbound.channel = None;
            outbound.pending.clear();
        }
    }
}

fn encode(message: &Value) -> Result<Vec<u8>, String> {
    let mut encoded = serde_json::to_vec(message).map_err(|error| error.to_string())?;
    encoded.push(b'\n');
    Ok(encoded)
}

fn dispatch(outbound: &OutboundMessages, line: &[u8]) -> Result<(), String> {
    let message = serde_json::from_slice(line).map_err(|error| error.to_string())?;
    let mut outbound = outbound.lock().map_err(|error| error.to_string())?;
    outbound.send(message);
    Ok(())
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
}
