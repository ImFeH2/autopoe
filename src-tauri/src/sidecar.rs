#[cfg(debug_assertions)]
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::AppHandle;
use tauri_plugin_shell::{
    ShellExt,
    process::{Command, CommandChild, CommandEvent},
};

#[derive(Default)]
pub struct Sidecar {
    child: Mutex<Option<CommandChild>>,
}

impl Sidecar {
    pub fn start(&self, app: &AppHandle) -> Result<(), String> {
        let (mut events, child) = sidecar_command(app)?
            .spawn()
            .map_err(|error| error.to_string())?;
        *self.child.lock().expect("sidecar child lock") = Some(child);

        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stderr(line) => {
                        eprintln!("flowent-agent: {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Error(error) => eprintln!("flowent-agent: {error}"),
                    CommandEvent::Terminated(_) => break,
                    _ => {}
                }
            }
        });

        Ok(())
    }

    pub fn stop(&self) {
        if let Some(child) = self.child.lock().expect("sidecar child lock").take() {
            let _ = child.kill();
        }
    }
}

#[cfg(debug_assertions)]
fn sidecar_command(app: &AppHandle) -> Result<Command, String> {
    let agent_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../agent");
    Ok(app
        .shell()
        .command("uv")
        .arg("run")
        .arg("--project")
        .arg(agent_dir)
        .arg("flowent"))
}

#[cfg(not(debug_assertions))]
fn sidecar_command(app: &AppHandle) -> Result<Command, String> {
    app.shell()
        .sidecar("flowent-agent")
        .map_err(|error| error.to_string())
}
