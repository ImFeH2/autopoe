use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::protocol::SandboxPolicy;
use crate::status::StatusRecord;

pub fn probe(_state_dir: &Path) -> AppResult<StatusRecord> {
    Err(AppError::unavailable(
        "This helper can protect commands only on Windows.",
    ))
}

pub fn setup(_state_dir: &Path, _owner_sid: Option<&str>) -> AppResult<StatusRecord> {
    Err(AppError::unavailable(
        "Windows protection setup is unavailable on this system.",
    ))
}

pub fn run(_state_dir: &Path, policy: SandboxPolicy, _command: Vec<String>) -> i32 {
    let error = AppError::unavailable("This helper can protect commands only on Windows.");
    let status = StatusRecord::failed(crate::status::Operation::Run, &error);
    let _ = crate::status::write_status(&policy.status_file, &status);
    eprintln!("{}", error.as_json());
    error.exit_code
}
