mod error;
mod secrets;
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

#[tauri::command]
fn set_secret(key: String, value: String) -> CommandResult<()> {
    secrets::set(&key, &value)?;
    Ok(())
}

#[tauri::command]
fn get_secret(key: String) -> CommandResult<Option<String>> {
    Ok(secrets::get(&key)?)
}

#[tauri::command]
fn delete_secret(key: String) -> CommandResult<()> {
    secrets::delete(&key)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar::default())
        .invoke_handler(tauri::generate_handler![
            send,
            subscribe,
            set_secret,
            get_secret,
            delete_secret
        ])
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
