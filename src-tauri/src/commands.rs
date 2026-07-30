use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{State, ipc::Channel};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::runtime::{RuntimeManager, RuntimeStatus, Scope};

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

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeEvent {
    pub name: String,
    pub sequence: Option<u64>,
    pub scope: Option<Scope>,
    pub payload: Value,
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
    runtime.register_agent_run(run_id.clone(), events, terminal_tx)?;
    let payload = serde_json::json!({
        "run_id": run_id,
        "messages": messages,
    });
    if let Err(error) = runtime
        .request("agent.run", payload, Some(run_id.clone()))
        .await
    {
        runtime.fail_agent_run(&run_id, error.clone());
        return Err(error);
    }
    match terminal_rx.await {
        Ok(result) => result,
        Err(_) => Err("Agent run ended without a terminal event".to_owned()),
    }
}

#[tauri::command]
pub async fn runtime_request(
    name: String,
    payload: Value,
    runtime: State<'_, RuntimeManager>,
) -> Result<Value, String> {
    runtime.wait_until_ready().await?;
    if !is_allowed_request(&name) {
        return Err(format!("Runtime request is not allowed: {name}"));
    }
    runtime.request(&name, payload, None).await
}

#[tauri::command]
pub async fn run_workflow(
    run_id: String,
    workflow_id: String,
    version: Option<u64>,
    input: Value,
    workspace: Option<Value>,
    events: Channel<RuntimeEvent>,
    runtime: State<'_, RuntimeManager>,
) -> Result<Value, String> {
    runtime.wait_until_ready().await?;
    let (terminal_tx, terminal_rx) = oneshot::channel();
    runtime.register_workflow_run(run_id.clone(), events, terminal_tx)?;
    let mut payload = serde_json::json!({
        "run_id": run_id,
        "workflow_id": workflow_id,
        "input": input,
    });
    if let Some(version) = version {
        payload["version"] = Value::from(version);
    }
    if let Some(workspace) = workspace {
        payload["workspace"] = workspace;
    }
    if let Err(error) = runtime
        .request("workflow.run", payload, Some(run_id.clone()))
        .await
    {
        runtime.fail_workflow_run(&run_id, error.clone());
        return Err(error);
    }
    match terminal_rx.await {
        Ok(result) => result,
        Err(_) => Err("Workflow run ended without a terminal event".to_owned()),
    }
}

#[tauri::command]
pub fn runtime_status(runtime: State<'_, RuntimeManager>) -> RuntimeStatus {
    runtime.status()
}

fn is_allowed_request(name: &str) -> bool {
    matches!(
        name,
        "runtime.ping"
            | "workflow.list"
            | "workflow.get"
            | "workflow.save"
            | "workflow.publish"
            | "workflow.cancel"
            | "approval.resolve"
            | "settings.get"
            | "settings.save"
    )
}

#[cfg(test)]
mod tests {
    use super::is_allowed_request;

    #[test]
    fn runtime_request_has_a_strict_allowlist() {
        assert!(is_allowed_request("workflow.list"));
        assert!(is_allowed_request("approval.resolve"));
        assert!(!is_allowed_request("runtime.shutdown"));
        assert!(!is_allowed_request("agent.run"));
    }
}
