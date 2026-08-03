mod error;
mod sidecar;

use error::CommandResult;
use serde_json::Value;
use sidecar::Sidecar;
use tauri::{Manager, State, ipc::Channel};

#[tauri::command]
fn send(sidecar: State<'_, Sidecar>, message: Value) -> CommandResult<()> {
    sidecar.send(&message)?;
    Ok(())
}

#[tauri::command]
fn subscribe(sidecar: State<'_, Sidecar>, channel: Channel<Value>) -> CommandResult<()> {
    sidecar.subscribe(channel)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar::default())
        .invoke_handler(tauri::generate_handler![send, subscribe])
        .setup(|app| {
            app.state::<Sidecar>()
                .start(app.handle())
                .map_err(|error| std::io::Error::other(format!("{error:#}")))?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app_handle.state::<Sidecar>().stop();
        }
    });
}
