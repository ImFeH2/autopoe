mod flowent;

use flowent::FlowentProcess;
use serde_json::Value;
use tauri::{Manager, ipc::Channel};

fn validate_frontend_message(message: &Value) -> Result<(), String> {
    if message
        .get("method")
        .and_then(Value::as_str)
        .is_some_and(|method| method.starts_with("system."))
    {
        return Err("Internal Flowent method".to_string());
    }
    Ok(())
}

#[tauri::command]
fn send(flowent: tauri::State<'_, FlowentProcess>, message: Value) -> Result<(), String> {
    validate_frontend_message(&message)?;
    flowent.send(message)
}

#[tauri::command]
fn subscribe(
    flowent: tauri::State<'_, FlowentProcess>,
    channel: Channel<Value>,
) -> Result<(), String> {
    flowent.subscribe(channel)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(feature = "debug")]
    let builder = builder
        .plugin(tauri_plugin_wdio_webdriver::init())
        .plugin(tauri_plugin_wdio::init());

    let app = builder
        .plugin(tauri_plugin_shell::init())
        .manage(FlowentProcess::default())
        .invoke_handler(tauri::generate_handler![send, subscribe])
        .setup(|app| {
            app.state::<FlowentProcess>()
                .start(app.handle())
                .map_err(|error| std::io::Error::other(format!("{error:#}")))?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app_handle.state::<FlowentProcess>().stop();
        }
    });
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::validate_frontend_message;

    #[test]
    fn reserves_internal_flowent_methods() {
        assert!(validate_frontend_message(&json!({"method": "organization.get"})).is_ok());
        assert_eq!(
            validate_frontend_message(&json!({"method": "system.shutdown"})).unwrap_err(),
            "Internal Flowent method"
        );
    }
}
