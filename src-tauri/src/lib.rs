mod commands;
mod demo_provider;

use commands::run_agent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![run_agent])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
