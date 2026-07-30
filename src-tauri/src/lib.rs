mod commands;
mod runtime;

use commands::{run_agent, run_workflow, runtime_request, runtime_status};
use runtime::RuntimeManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(RuntimeManager::default())
        .setup(|app| {
            let runtime = app.state::<RuntimeManager>();
            if let Err(error) = runtime.start(app.handle().clone()) {
                runtime.fail(error);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            run_agent,
            run_workflow,
            runtime_request,
            runtime_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
