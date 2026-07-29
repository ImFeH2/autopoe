use agent::{Agent, Message, RunEvent};
use tauri::ipc::Channel;

use crate::demo_provider::DemoProvider;

#[tauri::command]
pub async fn run_agent(messages: Vec<Message>, events: Channel<RunEvent>) -> Result<(), String> {
    Agent::new(DemoProvider)
        .run(messages, |event| {
            events.send(event).map_err(|error| error.to_string())
        })
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}
