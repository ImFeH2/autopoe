use std::{
    collections::VecDeque,
    ffi::OsString,
    path::PathBuf,
    sync::{Arc, Condvar, Mutex},
    time::{Duration, Instant},
};

use anyhow::{Context, Result, anyhow};
use serde_json::{Value, json};
use tauri::{AppHandle, ipc::Channel};
use tauri_plugin_shell::{
    ShellExt,
    process::{CommandChild, CommandEvent},
};

const TEST_RUNNER_ENV: &str = "FLOWENT_TEST_RUNNER";
const SHUTDOWN_ID: u64 = u64::MAX;

type SharedBridge = Arc<Bridge>;

struct Bridge {
    state: Mutex<BridgeState>,
    changed: Condvar,
}

struct BridgeState {
    child: Option<CommandChild>,
    failure: Option<String>,
    subscriber: Option<Channel<Value>>,
    buffered: VecDeque<Value>,
}

impl Default for Bridge {
    fn default() -> Self {
        Self {
            state: Mutex::new(BridgeState {
                child: None,
                failure: Some("Sidecar is not running".to_string()),
                subscriber: None,
                buffered: VecDeque::new(),
            }),
            changed: Condvar::new(),
        }
    }
}

pub struct Sidecar {
    bridge: SharedBridge,
    working_directory: PathBuf,
}

impl Default for Sidecar {
    fn default() -> Self {
        Self {
            bridge: Arc::new(Bridge::default()),
            working_directory: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        }
    }
}

impl Sidecar {
    pub fn start(&self, app: &AppHandle) -> Result<()> {
        let command = app
            .shell()
            .sidecar("flowent-agent")
            .context("create sidecar command")?
            .env_clear()
            .envs(filtered_environment(std::env::vars_os()))
            .current_dir(&self.working_directory);
        #[cfg(feature = "desktop-e2e")]
        let command = command.env(TEST_RUNNER_ENV, "deterministic");
        let (mut events, child) = command.spawn().context("start sidecar")?;

        {
            let mut state = self
                .bridge
                .state
                .lock()
                .map_err(|_| anyhow!("sidecar bridge lock poisoned"))?;
            state.child = Some(child);
            state.failure = None;
        }

        let bridge = Arc::clone(&self.bridge);
        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                if !handle_event(&bridge, event) {
                    return;
                }
            }
            close_bridge(&bridge, "Sidecar event stream closed", true);
        });

        Ok(())
    }

    pub fn send(&self, message: Value) -> Result<(), String> {
        let encoded = encode_message(&message)?;
        let write_result = {
            let mut state = self
                .bridge
                .state
                .lock()
                .map_err(|_| "Sidecar bridge lock poisoned".to_string())?;
            if let Some(error) = &state.failure {
                return Err(error.clone());
            }
            state
                .child
                .as_mut()
                .ok_or_else(|| "Sidecar is not running".to_string())?
                .write(&encoded)
                .map_err(|error| format!("Write Sidecar message: {error}"))
        };

        if let Err(error) = write_result {
            close_bridge(&self.bridge, &error, true);
            return Err(error);
        }
        Ok(())
    }

    pub fn subscribe(&self, channel: Channel<Value>) -> Result<(), String> {
        let mut state = self
            .bridge
            .state
            .lock()
            .map_err(|_| "Sidecar bridge lock poisoned".to_string())?;
        if let Some(error) = &state.failure {
            return Err(error.clone());
        }

        state.subscriber = Some(channel.clone());
        while let Some(message) = state.buffered.pop_front() {
            if let Err(error) = channel.send(message.clone()) {
                state.subscriber = None;
                state.buffered.push_front(message);
                return Err(format!("Subscribe to Sidecar messages: {error}"));
            }
        }
        Ok(())
    }

    pub fn stop(&self) {
        let shutdown = json!({
            "id": SHUTDOWN_ID,
            "method": "system.shutdown",
            "params": {},
        });
        let encoded = match encode_message(&shutdown) {
            Ok(encoded) => encoded,
            Err(_) => {
                close_bridge(&self.bridge, "Sidecar stopped", true);
                return;
            }
        };

        let mut state = match self.bridge.state.lock() {
            Ok(state) => state,
            Err(_) => return,
        };
        if state.failure.is_some() || state.child.is_none() {
            return;
        }
        if state
            .child
            .as_mut()
            .expect("sidecar child checked above")
            .write(&encoded)
            .is_err()
        {
            drop(state);
            close_bridge(&self.bridge, "Sidecar stopped", true);
            return;
        }

        let deadline = Instant::now() + Duration::from_secs(25);
        while state.child.is_some() {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            let waited = self.bridge.changed.wait_timeout(state, remaining);
            let Ok((next_state, timeout)) = waited else {
                return;
            };
            state = next_state;
            if timeout.timed_out() {
                break;
            }
        }
        let child = state.child.take();
        state.failure = Some("Sidecar stopped".to_string());
        state.subscriber = None;
        drop(state);

        if let Some(child) = child {
            let _ = child.kill();
        }
    }
}

fn filtered_environment(
    environment: impl IntoIterator<Item = (OsString, OsString)>,
) -> Vec<(OsString, OsString)> {
    environment
        .into_iter()
        .filter(|(key, _)| !key.eq_ignore_ascii_case(TEST_RUNNER_ENV))
        .collect()
}

fn encode_message(message: &Value) -> Result<Vec<u8>, String> {
    let mut encoded =
        serde_json::to_vec(message).map_err(|error| format!("Encode Sidecar message: {error}"))?;
    encoded.push(b'\n');
    Ok(encoded)
}

fn handle_event(bridge: &SharedBridge, event: CommandEvent) -> bool {
    match event {
        CommandEvent::Stdout(line) => {
            let message = match serde_json::from_slice(&line) {
                Ok(message) => message,
                Err(error) => {
                    let detail = format!("Invalid Sidecar JSON: {error}");
                    eprintln!("[Sidecar] {detail}");
                    close_bridge(bridge, &detail, true);
                    return false;
                }
            };
            if let Err(error) = forward_message(bridge, message) {
                eprintln!("[Sidecar] {error}");
            }
        }
        CommandEvent::Stderr(line) => {
            eprint!("[Sidecar] {}", String::from_utf8_lossy(&line));
        }
        CommandEvent::Error(error) => {
            let detail = format!("Sidecar event error: {error}");
            eprintln!("[Sidecar] {detail}");
            close_bridge(bridge, &detail, true);
            return false;
        }
        CommandEvent::Terminated(_) => {
            close_bridge(bridge, "Sidecar stopped", false);
            return false;
        }
        _ => {}
    }
    true
}

fn forward_message(bridge: &SharedBridge, message: Value) -> Result<(), String> {
    let mut state = bridge
        .state
        .lock()
        .map_err(|_| "Sidecar bridge lock poisoned".to_string())?;
    if state.failure.is_some() {
        return Ok(());
    }
    let Some(channel) = state.subscriber.clone() else {
        state.buffered.push_back(message);
        return Ok(());
    };
    if let Err(error) = channel.send(message.clone()) {
        if state
            .subscriber
            .as_ref()
            .is_some_and(|current| current.id() == channel.id())
        {
            state.subscriber = None;
        }
        state.buffered.push_back(message);
        return Err(format!("Forward Sidecar message: {error}"));
    }
    Ok(())
}

fn close_bridge(bridge: &SharedBridge, message: &str, kill: bool) {
    let child = match bridge.state.lock() {
        Ok(mut state) => {
            if state.failure.is_none() {
                state.failure = Some(message.to_string());
            }
            state.subscriber = None;
            state.child.take()
        }
        Err(_) => return,
    };
    bridge.changed.notify_all();

    if kill && let Some(child) = child {
        let _ = child.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tauri::ipc::InvokeResponseBody;

    fn open_bridge() -> SharedBridge {
        Arc::new(Bridge {
            state: Mutex::new(BridgeState {
                child: None,
                failure: None,
                subscriber: None,
                buffered: VecDeque::new(),
            }),
            changed: Condvar::new(),
        })
    }

    fn collecting_channel(messages: Arc<Mutex<Vec<Value>>>) -> Channel<Value> {
        Channel::new(move |body| {
            let InvokeResponseBody::Json(json) = body else {
                panic!("expected JSON channel message");
            };
            messages.lock().unwrap().push(serde_json::from_str(&json)?);
            Ok(())
        })
    }

    #[test]
    fn removes_test_runner_from_inherited_environment() {
        let environment = filtered_environment([
            (OsString::from("PATH"), OsString::from("/bin")),
            (
                OsString::from(TEST_RUNNER_ENV),
                OsString::from("deterministic"),
            ),
            (
                OsString::from("flowent_test_runner"),
                OsString::from("deterministic"),
            ),
            (
                OsString::from("Flowent_Test_Runner"),
                OsString::from("deterministic"),
            ),
        ]);

        assert_eq!(
            environment,
            vec![(OsString::from("PATH"), OsString::from("/bin"))]
        );
    }

    #[test]
    fn encodes_one_json_value_per_line() {
        let encoded = encode_message(&json!({"id": 1, "params": {}})).unwrap();
        assert_eq!(encoded.last(), Some(&b'\n'));
        assert_eq!(
            serde_json::from_slice::<Value>(&encoded[..encoded.len() - 1]).unwrap(),
            json!({"id": 1, "params": {}})
        );
    }

    #[test]
    fn buffers_json_until_a_subscriber_is_ready() {
        let bridge = open_bridge();
        forward_message(&bridge, json!({"id": 1, "result": null})).unwrap();
        let messages = Arc::new(Mutex::new(Vec::new()));
        let sidecar = Sidecar {
            bridge,
            working_directory: PathBuf::new(),
        };

        sidecar
            .subscribe(collecting_channel(Arc::clone(&messages)))
            .unwrap();

        assert_eq!(
            *messages.lock().unwrap(),
            vec![json!({"id": 1, "result": null})]
        );
    }

    #[test]
    fn forwards_every_json_value_to_the_subscriber() {
        let bridge = open_bridge();
        let messages = Arc::new(Mutex::new(Vec::new()));
        let sidecar = Sidecar {
            bridge: Arc::clone(&bridge),
            working_directory: PathBuf::new(),
        };
        sidecar
            .subscribe(collecting_channel(Arc::clone(&messages)))
            .unwrap();

        for message in [json!({"id": 1}), json!([1, 2]), Value::Null] {
            forward_message(&bridge, message).unwrap();
        }

        assert_eq!(
            *messages.lock().unwrap(),
            vec![json!({"id": 1}), json!([1, 2]), Value::Null]
        );
    }

    #[test]
    fn malformed_stdout_closes_the_bridge() {
        let bridge = open_bridge();

        assert!(!handle_event(
            &bridge,
            CommandEvent::Stdout(b"not-json".to_vec())
        ));
        assert!(bridge.state.lock().unwrap().failure.is_some());
    }

    #[test]
    fn command_error_closes_the_bridge() {
        let bridge = open_bridge();

        assert!(!handle_event(
            &bridge,
            CommandEvent::Error("read failed".to_string())
        ));
        assert_eq!(
            bridge.state.lock().unwrap().failure.as_deref(),
            Some("Sidecar event error: read failed")
        );
    }

    #[test]
    fn event_stream_close_closes_the_bridge() {
        let bridge = open_bridge();

        close_bridge(&bridge, "Sidecar event stream closed", true);

        assert_eq!(
            bridge.state.lock().unwrap().failure.as_deref(),
            Some("Sidecar event stream closed")
        );
    }

    #[test]
    fn send_after_close_fails_immediately() {
        let sidecar = Sidecar::default();

        assert_eq!(
            sidecar.send(json!({"id": 1})).unwrap_err(),
            "Sidecar is not running"
        );
    }

    #[test]
    fn stopping_an_idle_sidecar_is_safe() {
        Sidecar::default().stop();
    }
}
