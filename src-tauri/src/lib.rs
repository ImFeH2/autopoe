mod sidecar;

use sidecar::{AppInfo, Sidecar};
use tauri::{Manager, State};

#[tauri::command]
async fn get_app_info(sidecar: State<'_, Sidecar>) -> Result<AppInfo, String> {
    sidecar.app_info().await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar::default())
        .invoke_handler(tauri::generate_handler![get_app_info])
        .setup(|app| {
            app.state::<Sidecar>()
                .start(app.handle())
                .map_err(std::io::Error::other)?;
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
