mod acl;
mod acl_lock;
mod desktop;
mod firewall;
mod ipc;
mod job;
mod process;
mod runner;
mod setup;
mod token;
mod util;

use std::path::Path;

use crate::error::AppResult;
use crate::protocol::SandboxPolicy;
use crate::status::{Operation, StatusRecord};

pub fn probe(state_dir: &Path) -> AppResult<StatusRecord> {
    setup::load(state_dir)?;
    Ok(StatusRecord::ready(
        Operation::Probe,
        "Windows command protection is ready.",
    ))
}

pub fn setup(state_dir: &Path, owner_sid: Option<&str>) -> AppResult<StatusRecord> {
    setup::install(state_dir, owner_sid)?;
    Ok(StatusRecord::ready(
        Operation::Setup,
        "Windows command protection is ready.",
    ))
}

pub fn run(state_dir: &Path, policy: SandboxPolicy, command: Vec<String>) -> i32 {
    match setup::load(state_dir) {
        Ok(installed) => runner::run_parent(&installed, policy, command),
        Err(error) => {
            let status = StatusRecord::failed(Operation::Run, &error);
            let _ = crate::status::write_status(&policy.status_file, &status);
            eprintln!("{}", error.as_json());
            error.exit_code
        }
    }
}

pub fn worker(pipe_name: &str) -> i32 {
    runner::run_worker(pipe_name)
}
