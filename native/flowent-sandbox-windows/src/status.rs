use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::error::{AppError, AppResult};
use crate::protocol::{PROTOCOL_VERSION, SETUP_VERSION};

static STATUS_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    Probe,
    Setup,
    Run,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StatusState {
    Ready,
    SetupRequired,
    Running,
    Completed,
    Failed,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatusRecord {
    pub version: u32,
    pub operation: Operation,
    pub state: StatusState,
    pub code: String,
    pub message: String,
    pub setup_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}

impl StatusRecord {
    pub fn ready(operation: Operation, message: impl Into<String>) -> Self {
        Self::new(operation, StatusState::Ready, "ready", message)
    }

    pub fn setup_required(operation: Operation, message: impl Into<String>) -> Self {
        Self::new(
            operation,
            StatusState::SetupRequired,
            "setup_required",
            message,
        )
    }

    pub fn running(process_id: u32) -> Self {
        let mut status = Self::new(
            Operation::Run,
            StatusState::Running,
            "running",
            "Command protection is active.",
        );
        status.process_id = Some(process_id);
        status
    }

    pub fn completed(exit_code: i32) -> Self {
        let mut status = Self::new(
            Operation::Run,
            StatusState::Completed,
            "completed",
            "Protected command completed.",
        );
        status.exit_code = Some(exit_code);
        status
    }

    pub fn failed(operation: Operation, error: &AppError) -> Self {
        let state = if error.code == "setup_required" {
            StatusState::SetupRequired
        } else if error.code == "sandbox_unavailable" {
            StatusState::Unavailable
        } else {
            StatusState::Failed
        };
        Self::new(operation, state, error.code.clone(), error.message.clone())
    }

    pub fn is_success(&self) -> bool {
        matches!(self.state, StatusState::Ready | StatusState::Completed)
    }

    pub fn as_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| {
            "{\"version\":1,\"state\":\"failed\",\"code\":\"serialization_failed\"}".to_string()
        })
    }

    fn new(
        operation: Operation,
        state: StatusState,
        code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            operation,
            state,
            code: code.into(),
            message: message.into(),
            setup_version: SETUP_VERSION,
            process_id: None,
            exit_code: None,
        }
    }
}

pub fn write_status(path: &Path, status: &StatusRecord) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::invalid("Status file has no parent directory."))?;
    fs::create_dir_all(parent)
        .map_err(|error| AppError::io("Could not create status directory", error))?;
    let sequence = STATUS_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(
        ".flowent-status-{}-{sequence}.tmp",
        std::process::id()
    ));
    let bytes = serde_json::to_vec(status)
        .map_err(|error| AppError::windows("status_serialization_failed", error.to_string()))?;
    fs::write(&temporary, bytes)
        .map_err(|error| AppError::io("Could not write status file", error))?;
    if let Err(error) = fs::rename(&temporary, path) {
        if path.exists() {
            fs::remove_file(path).map_err(|remove_error| {
                AppError::io("Could not replace status file", remove_error)
            })?;
            fs::rename(&temporary, path).map_err(|rename_error| {
                AppError::io("Could not replace status file", rename_error)
            })?;
        } else {
            return Err(AppError::io("Could not publish status file", error));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{Operation, StatusRecord, StatusState};
    use crate::error::AppError;

    #[test]
    fn status_failure_preserves_structured_code() {
        let status = StatusRecord::failed(
            Operation::Run,
            &AppError::windows("job_assignment_failed", "Could not secure process tree."),
        );
        assert_eq!(status.state, StatusState::Failed);
        assert_eq!(status.code, "job_assignment_failed");
        assert!(status.as_json().contains("job_assignment_failed"));
    }

    #[test]
    fn setup_required_is_not_reported_as_generic_failure() {
        let status = StatusRecord::failed(
            Operation::Probe,
            &AppError::setup_required("Run setup first."),
        );
        assert_eq!(status.state, StatusState::SetupRequired);
    }
}
