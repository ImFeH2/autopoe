mod cli;
mod error;
mod protocol;
mod status;

#[cfg(not(windows))]
mod unsupported;
#[cfg(windows)]
mod windows;

use std::ffi::OsString;

use cli::CliCommand;
use error::AppError;
use status::{Operation, StatusRecord, write_status};

pub fn run_cli<I>(arguments: I) -> i32
where
    I: IntoIterator<Item = OsString>,
{
    match cli::parse(arguments) {
        Ok(CliCommand::Help) => {
            println!("{}", cli::usage());
            0
        }
        Ok(command) => dispatch(command),
        Err(error) => {
            eprintln!("{}", error.as_json());
            error.exit_code
        }
    }
}

fn dispatch(command: CliCommand) -> i32 {
    match command {
        CliCommand::Probe {
            state_dir,
            status_file,
        } => {
            #[cfg(windows)]
            let result = windows::probe(&state_dir);
            #[cfg(not(windows))]
            let result = unsupported::probe(&state_dir);
            finish_status(Operation::Probe, &status_file, result)
        }
        CliCommand::Setup {
            state_dir,
            status_file,
            owner_sid,
        } => {
            #[cfg(windows)]
            let result = windows::setup(&state_dir, owner_sid.as_deref());
            #[cfg(not(windows))]
            let result = unsupported::setup(&state_dir, owner_sid.as_deref());
            finish_status(Operation::Setup, &status_file, result)
        }
        CliCommand::Run {
            state_dir,
            policy_file,
            command,
        } => {
            let policy = match protocol::SandboxPolicy::from_file(&policy_file) {
                Ok(policy) => policy,
                Err(error) => {
                    eprintln!("{}", error.as_json());
                    return error.exit_code;
                }
            };
            if let Err(error) = policy.validate() {
                let status = StatusRecord::failed(Operation::Run, &error);
                let _ = write_status(&policy.status_file, &status);
                eprintln!("{}", error.as_json());
                return error.exit_code;
            }
            #[cfg(windows)]
            return windows::run(&state_dir, policy, command);
            #[cfg(not(windows))]
            return unsupported::run(&state_dir, policy, command);
        }
        CliCommand::Worker { pipe_name } => {
            #[cfg(windows)]
            return windows::worker(&pipe_name);
            #[cfg(not(windows))]
            {
                let _ = pipe_name;
                let error =
                    AppError::unavailable("Windows worker mode is unavailable on this system.");
                eprintln!("{}", error.as_json());
                error.exit_code
            }
        }
        CliCommand::Help => 0,
    }
}

fn finish_status(
    operation: Operation,
    status_file: &std::path::Path,
    result: Result<StatusRecord, AppError>,
) -> i32 {
    match result {
        Ok(status) => match write_status(status_file, &status) {
            Ok(()) => {
                println!("{}", status.as_json());
                if status.is_success() { 0 } else { 1 }
            }
            Err(error) => {
                eprintln!("{}", error.as_json());
                error.exit_code
            }
        },
        Err(error) => {
            let status = StatusRecord::failed(operation, &error);
            if let Err(status_error) = write_status(status_file, &status) {
                eprintln!("{}", status_error.as_json());
            }
            eprintln!("{}", error.as_json());
            error.exit_code
        }
    }
}
