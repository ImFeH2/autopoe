use serde::{Deserialize, Serialize};
use tauri::{State, ipc::Channel};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::runtime::{RuntimeManager, RuntimeStatus};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AgentMessage {
    role: String,
    content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RunEvent {
    Started,
    TextDelta { delta: String },
    Completed,
    Failed { message: String },
    Cancelled,
}

#[tauri::command]
pub async fn run_agent(
    messages: Vec<AgentMessage>,
    events: Channel<RunEvent>,
    runtime: State<'_, RuntimeManager>,
) -> Result<(), String> {
    runtime.wait_until_ready().await?;

    let run_id = Uuid::new_v4().simple().to_string();
    let (terminal_tx, terminal_rx) = oneshot::channel();
    runtime.register_run(run_id.clone(), events, terminal_tx)?;

    let payload = serde_json::json!({
        "run_id": run_id,
        "messages": messages,
    });

    if let Err(error) = runtime.send_request("agent.run", payload, Some(run_id.clone())) {
        runtime.fail_run(&run_id, error.clone());
        return Err(error);
    }

    match terminal_rx.await {
        Ok(result) => result,
        Err(_) => Err("Agent run ended without a terminal event".to_owned()),
    }
}

#[tauri::command]
pub fn runtime_status(runtime: State<'_, RuntimeManager>) -> RuntimeStatus {
    runtime.status()
}
