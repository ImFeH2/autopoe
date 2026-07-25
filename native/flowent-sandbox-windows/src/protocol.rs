use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

pub const PROTOCOL_VERSION: u32 = 1;
pub const SETUP_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NetworkMode {
    #[default]
    Enabled,
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SandboxPolicy {
    #[serde(default = "protocol_version")]
    pub version: u32,
    pub cwd: PathBuf,
    #[serde(default)]
    pub writable_roots: Vec<PathBuf>,
    pub runtime_dir: PathBuf,
    #[serde(default)]
    pub network: NetworkMode,
    pub status_file: PathBuf,
}

impl SandboxPolicy {
    pub fn from_file(path: &Path) -> AppResult<Self> {
        let bytes = fs::read(path).map_err(|error| AppError::io("Could not read policy", error))?;
        serde_json::from_slice(&bytes)
            .map_err(|error| AppError::invalid(format!("Invalid policy JSON: {error}")))
    }

    pub fn validate(&self) -> AppResult<()> {
        if self.version != PROTOCOL_VERSION {
            return Err(AppError::invalid(format!(
                "Unsupported policy version: {}.",
                self.version
            )));
        }
        require_absolute("cwd", &self.cwd)?;
        require_absolute("runtime_dir", &self.runtime_dir)?;
        require_absolute("status_file", &self.status_file)?;
        for root in &self.writable_roots {
            require_absolute("writable_roots", root)?;
        }
        Ok(())
    }

    pub fn effective_writable_roots(&self) -> Vec<PathBuf> {
        let mut roots = vec![self.cwd.clone()];
        for root in &self.writable_roots {
            if !roots.iter().any(|existing| same_path(existing, root)) {
                roots.push(root.clone());
            }
        }
        roots
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerRequest {
    pub version: u32,
    pub policy: SandboxPolicy,
    pub command: Vec<String>,
    pub account_sid: String,
    pub base_sid: String,
    pub capability_sid: String,
}

impl WorkerRequest {
    pub fn validate(&self) -> AppResult<()> {
        if self.version != PROTOCOL_VERSION {
            return Err(AppError::invalid(format!(
                "Unsupported worker protocol version: {}.",
                self.version
            )));
        }
        self.policy.validate()?;
        if self.command.is_empty() || self.command[0].is_empty() {
            return Err(AppError::invalid("Worker request has no command."));
        }
        if self.account_sid.is_empty() || self.base_sid.is_empty() || self.capability_sid.is_empty()
        {
            return Err(AppError::invalid(
                "Worker request has no security identifiers.",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkerFrame {
    Started { process_id: u32 },
    Stdout { data: String },
    Stderr { data: String },
    Exited { exit_code: i32 },
    Failed { code: String, message: String },
}

fn protocol_version() -> u32 {
    PROTOCOL_VERSION
}

fn require_absolute(name: &str, path: &Path) -> AppResult<()> {
    if !path.is_absolute() {
        return Err(AppError::invalid(format!(
            "Policy field {name} must be an absolute path."
        )));
    }
    Ok(())
}

#[cfg(windows)]
fn same_path(left: &Path, right: &Path) -> bool {
    left.to_string_lossy()
        .eq_ignore_ascii_case(&right.to_string_lossy())
}

#[cfg(not(windows))]
fn same_path(left: &Path, right: &Path) -> bool {
    left == right
}

#[cfg(test)]
mod tests {
    use super::{NetworkMode, PROTOCOL_VERSION, SandboxPolicy};
    use std::path::PathBuf;

    #[test]
    fn network_defaults_to_enabled() {
        let policy: SandboxPolicy = serde_json::from_str(
            r#"{"cwd":"/workspace","writable_roots":[],"runtime_dir":"/runtime","status_file":"/status.json"}"#,
        )
        .unwrap();
        assert_eq!(policy.network, NetworkMode::Enabled);
        assert_eq!(policy.version, PROTOCOL_VERSION);
    }

    #[test]
    fn unknown_fields_are_rejected() {
        let error = serde_json::from_str::<SandboxPolicy>(
            r#"{"cwd":"/workspace","writable_roots":[],"runtime_dir":"/runtime","status_file":"/status.json","bypass":true}"#,
        )
        .unwrap_err();
        assert!(error.to_string().contains("unknown field"));
    }

    #[test]
    fn effective_roots_include_cwd_and_deduplicate() {
        let policy = SandboxPolicy {
            version: PROTOCOL_VERSION,
            cwd: PathBuf::from("/workspace"),
            writable_roots: vec![PathBuf::from("/workspace"), PathBuf::from("/approved")],
            runtime_dir: PathBuf::from("/runtime"),
            network: NetworkMode::Disabled,
            status_file: PathBuf::from("/status.json"),
        };
        assert_eq!(
            policy.effective_writable_roots(),
            vec![PathBuf::from("/workspace"), PathBuf::from("/approved"),]
        );
    }

    #[test]
    fn relative_paths_are_rejected() {
        let policy = SandboxPolicy {
            version: PROTOCOL_VERSION,
            cwd: PathBuf::from("workspace"),
            writable_roots: Vec::new(),
            runtime_dir: PathBuf::from("/runtime"),
            network: NetworkMode::Enabled,
            status_file: PathBuf::from("/status.json"),
        };
        assert_eq!(policy.validate().unwrap_err().code, "invalid_request");
    }
}
