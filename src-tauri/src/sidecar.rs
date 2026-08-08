use std::sync::Mutex;

use anyhow::{Context, Result, anyhow};
use tauri::AppHandle;
use tauri_plugin_shell::{
    ShellExt,
    process::{CommandChild, CommandEvent},
};

#[derive(Default)]
pub struct Sidecar {
    child: Mutex<Option<CommandChild>>,
}

impl Sidecar {
    pub fn start(&self, app: &AppHandle) -> Result<()> {
        let (mut events, child) = app
            .shell()
            .sidecar("flowent-agent")
            .context("create sidecar command")?
            .spawn()
            .context("start sidecar")?;
        *self
            .child
            .lock()
            .map_err(|_| anyhow!("sidecar child lock poisoned"))? = Some(child);

        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                if matches!(event, CommandEvent::Terminated(_)) {
                    break;
                }
            }
        });

        Ok(())
    }

    pub fn stop(&self) {
        if let Ok(mut child) = self.child.lock()
            && let Some(child) = child.take()
        {
            let _ = child.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stopping_an_idle_sidecar_is_safe() {
        Sidecar::default().stop();
    }
}
