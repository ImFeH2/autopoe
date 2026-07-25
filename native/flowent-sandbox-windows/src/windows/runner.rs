use std::io::Write;
use std::mem::size_of;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use windows_sys::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows_sys::Win32::System::Diagnostics::Debug::SetErrorMode;
use windows_sys::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateProcessWithLogonW,
    GetExitCodeProcess, LOGON_WITH_PROFILE, PROCESS_INFORMATION, ResumeThread, STARTUPINFOW,
    TerminateProcess, WaitForSingleObject,
};

use crate::error::{AppError, AppResult};
use crate::protocol::{NetworkMode, PROTOCOL_VERSION, SandboxPolicy, WorkerFrame, WorkerRequest};
use crate::status::{Operation, StatusRecord, write_status};

use super::acl::{grant_modify, protect_runtime_directory, revoke};
use super::ipc::Pipe;
use super::job::KillJob;
use super::process;
use super::setup::{AccountCredentials, InstalledSetup};
use super::token::verify_current_account;
use super::util::{OwnedHandle, quote_command, random_hex, sid_from_string, wide, wide_path};

const SEM_FAILCRITICALERRORS: u32 = 0x0001;
const SEM_NOGPFAULTERRORBOX: u32 = 0x0002;

pub fn run_parent(installed: &InstalledSetup, policy: SandboxPolicy, command: Vec<String>) -> i32 {
    suppress_system_dialogs();
    let status_path = policy.status_file.clone();
    match run_parent_inner(installed, &policy, command) {
        Ok(exit_code) => exit_code,
        Err(error) => {
            let status = StatusRecord::failed(Operation::Run, &error);
            if let Err(status_error) = write_status(&status_path, &status) {
                eprintln!("{}", status_error.as_json());
            }
            eprintln!("{}", error.as_json());
            error.exit_code
        }
    }
}

fn run_parent_inner(
    installed: &InstalledSetup,
    policy: &SandboxPolicy,
    command: Vec<String>,
) -> AppResult<i32> {
    trace("runtime_validation_started");
    validate_runtime_paths(policy)?;
    trace("runtime_validation_ready");
    let credentials = match policy.network {
        NetworkMode::Enabled => &installed.online,
        NetworkMode::Disabled => &installed.offline,
    };
    let account_sid = match policy.network {
        NetworkMode::Enabled => &installed.marker.online_sid,
        NetworkMode::Disabled => &installed.marker.offline_sid,
    };
    let capability_sid = create_capability_sid()?;
    let capability = sid_from_string(&capability_sid)?;
    let base = sid_from_string(&installed.marker.group_sid)?;
    trace("workspace_access_started");
    let mut lease = AclLease::acquire(policy.effective_writable_roots(), &base, &capability)?;
    trace("workspace_access_ready");
    protect_runtime_directory(&policy.runtime_dir, &installed.marker.owner_sid, &base)?;
    trace("runtime_access_ready");
    let (mut pipe, pipe_name) = Pipe::create_server(&installed.marker.owner_sid, account_sid)?;
    trace("worker_launch_started");
    let worker = launch_worker(credentials, &pipe_name, &policy.runtime_dir)?;
    trace("worker_launched");
    pipe.connect_server(worker.process.get())?;
    trace("worker_connected");
    let request = WorkerRequest {
        version: PROTOCOL_VERSION,
        policy: policy.clone(),
        command,
        account_sid: account_sid.clone(),
        base_sid: installed.marker.group_sid.clone(),
        capability_sid,
        trace: trace_enabled(),
    };
    request.validate()?;
    pipe.send(&request)?;
    trace("request_sent");
    let terminal = loop {
        match pipe.receive::<WorkerFrame>()? {
            WorkerFrame::Progress { stage } => trace(&format!("worker_{stage}")),
            WorkerFrame::Started { process_id } => {
                trace("command_started");
                write_status(&policy.status_file, &StatusRecord::running(process_id))?;
            }
            WorkerFrame::Stdout { data } => {
                let mut stdout = std::io::stdout().lock();
                stdout
                    .write_all(data.as_bytes())
                    .and_then(|_| stdout.flush())
                    .map_err(|error| AppError::io("Could not forward command output", error))?;
            }
            WorkerFrame::Stderr { data } => {
                let mut stderr = std::io::stderr().lock();
                stderr
                    .write_all(data.as_bytes())
                    .and_then(|_| stderr.flush())
                    .map_err(|error| {
                        AppError::io("Could not forward command error output", error)
                    })?;
            }
            WorkerFrame::Exited { exit_code } => {
                trace(&format!("command_exited_{exit_code}"));
                break Ok(exit_code);
            }
            WorkerFrame::Failed { code, message } => {
                break Err(AppError::windows(code, message));
            }
        }
    };
    trace("terminal_frame_received");
    let worker_result = worker.wait();
    trace("worker_stopped");
    let cleanup_result = lease.release();
    trace("workspace_access_released");
    let exit_code = terminal?;
    worker_result?;
    cleanup_result?;
    write_status(&policy.status_file, &StatusRecord::completed(exit_code))?;
    Ok(exit_code)
}

pub fn run_worker(pipe_name: &str) -> i32 {
    suppress_system_dialogs();
    let pipe = match Pipe::connect_client(pipe_name) {
        Ok(pipe) => pipe,
        Err(error) => {
            eprintln!("{}", error.as_json());
            return error.exit_code;
        }
    };
    run_worker_connected(pipe)
}

fn run_worker_connected(mut pipe: Pipe) -> i32 {
    let prepared = (|| -> AppResult<(WorkerRequest, process::ProtectedProcess)> {
        let request = pipe.receive::<WorkerRequest>()?;
        let trace = request.trace;
        send_progress(&mut pipe, trace, "request_received")?;
        request.validate()?;
        send_progress(&mut pipe, trace, "request_validated")?;
        verify_current_account(&request.account_sid, &request.base_sid)?;
        send_progress(&mut pipe, trace, "identity_verified")?;
        let child = process::spawn(
            &request.command,
            &request.policy.cwd,
            &request.base_sid,
            &request.capability_sid,
            |stage| send_progress(&mut pipe, trace, stage),
        )?;
        Ok((request, child))
    })();
    let (_, mut child) = match prepared {
        Ok(prepared) => prepared,
        Err(error) => {
            let _ = pipe.send(&WorkerFrame::Failed {
                code: error.code.clone(),
                message: error.message.clone(),
            });
            return error.exit_code;
        }
    };
    let process_id = child.process_id;
    let stdout = match child.take_stdout() {
        Ok(stdout) => stdout,
        Err(error) => return send_connected_failure(&mut pipe, error),
    };
    let stderr = match child.take_stderr() {
        Ok(stderr) => stderr,
        Err(error) => return send_connected_failure(&mut pipe, error),
    };
    let shared_pipe = Arc::new(Mutex::new(pipe));
    let stdout_pipe = Arc::clone(&shared_pipe);
    let stdout_thread = process::read_output(stdout, move |data| {
        stdout_pipe
            .lock()
            .map_err(|_| {
                AppError::windows("ipc_lock_failed", "Protected communication lock failed.")
            })?
            .send(&WorkerFrame::Stdout { data })
    });
    let stderr_pipe = Arc::clone(&shared_pipe);
    let stderr_thread = process::read_output(stderr, move |data| {
        stderr_pipe
            .lock()
            .map_err(|_| {
                AppError::windows("ipc_lock_failed", "Protected communication lock failed.")
            })?
            .send(&WorkerFrame::Stderr { data })
    });
    let result = (|| -> AppResult<()> {
        shared_pipe
            .lock()
            .map_err(|_| {
                AppError::windows("ipc_lock_failed", "Protected communication lock failed.")
            })?
            .send(&WorkerFrame::Started { process_id })?;
        let exit_code = child.wait()?;
        join_output(stdout_thread)?;
        join_output(stderr_thread)?;
        shared_pipe
            .lock()
            .map_err(|_| {
                AppError::windows("ipc_lock_failed", "Protected communication lock failed.")
            })?
            .send(&WorkerFrame::Exited { exit_code })?;
        Ok(())
    })();
    match result {
        Ok(()) => 0,
        Err(error) => {
            if let Ok(mut pipe) = shared_pipe.lock() {
                let _ = pipe.send(&WorkerFrame::Failed {
                    code: error.code.clone(),
                    message: error.message.clone(),
                });
            }
            error.exit_code
        }
    }
}

fn trace_enabled() -> bool {
    std::env::var_os("FLOWENT_NATIVE_TRACE").is_some_and(|value| value == "1")
}

fn trace(stage: &str) {
    if trace_enabled() {
        eprintln!("Flowent native trace: {stage}");
    }
}

fn send_progress(pipe: &mut Pipe, enabled: bool, stage: &'static str) -> AppResult<()> {
    if enabled {
        pipe.send(&WorkerFrame::Progress {
            stage: stage.to_string(),
        })?;
    }
    Ok(())
}

fn suppress_system_dialogs() {
    unsafe {
        SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    }
}

fn send_connected_failure(pipe: &mut Pipe, error: AppError) -> i32 {
    let _ = pipe.send(&WorkerFrame::Failed {
        code: error.code.clone(),
        message: error.message.clone(),
    });
    error.exit_code
}

fn join_output(thread: std::thread::JoinHandle<AppResult<()>>) -> AppResult<()> {
    thread.join().map_err(|_| {
        AppError::windows(
            "output_forward_failed",
            "Protected command output worker stopped unexpectedly.",
        )
    })?
}

struct WorkerProcess {
    process: OwnedHandle,
    _job: KillJob,
}

impl WorkerProcess {
    fn wait(self) -> AppResult<()> {
        let wait = unsafe { WaitForSingleObject(self.process.get(), 30000) };
        if wait == WAIT_TIMEOUT {
            return Err(AppError::windows(
                "worker_exit_failed",
                "Protected command worker did not exit after reporting completion.",
            ));
        }
        if wait != WAIT_OBJECT_0 {
            return Err(super::util::last_error(
                "worker_exit_failed",
                "Could not wait for protected command worker.",
            ));
        }
        let mut exit_code = 0u32;
        if unsafe { GetExitCodeProcess(self.process.get(), &mut exit_code) } == 0 {
            return Err(super::util::last_error(
                "worker_exit_failed",
                "Could not read protected command worker result.",
            ));
        }
        if exit_code != 0 {
            return Err(AppError::windows(
                "worker_exit_failed",
                format!("Protected command worker exited with code {exit_code}."),
            ));
        }
        Ok(())
    }
}

fn launch_worker(
    credentials: &AccountCredentials,
    pipe_name: &str,
    runtime_dir: &Path,
) -> AppResult<WorkerProcess> {
    let executable = std::env::current_exe()
        .map_err(|error| AppError::io("Could not locate native helper", error))?;
    let command = vec![
        executable.to_string_lossy().into_owned(),
        "__worker".to_string(),
        "--pipe".to_string(),
        pipe_name.to_string(),
    ];
    let executable_wide = wide_path(&executable);
    let mut command_line = quote_command(&command)?;
    let username = wide(&credentials.username);
    let domain = wide(".");
    let password = wide(&credentials.password);
    let current_directory = wide_path(runtime_dir);
    let mut startup = STARTUPINFOW::default();
    startup.cb = size_of::<STARTUPINFOW>() as u32;
    let mut information = PROCESS_INFORMATION::default();
    if unsafe {
        CreateProcessWithLogonW(
            username.as_ptr(),
            domain.as_ptr(),
            password.as_ptr(),
            LOGON_WITH_PROFILE,
            executable_wide.as_ptr(),
            command_line.as_mut_ptr(),
            CREATE_NO_WINDOW | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
            std::ptr::null(),
            current_directory.as_ptr(),
            &startup,
            &mut information,
        )
    } == 0
    {
        return Err(super::util::last_error(
            "worker_start_failed",
            "Could not create suspended protected command worker.",
        ));
    }
    let process = OwnedHandle::new(
        information.hProcess,
        "worker_start_failed",
        "Could not open protected command worker.",
    )?;
    let thread = OwnedHandle::new(
        information.hThread,
        "worker_start_failed",
        "Could not open protected command worker thread.",
    )?;
    let job = match KillJob::create() {
        Ok(job) => job,
        Err(error) => {
            terminate_suspended(process.get());
            return Err(error);
        }
    };
    if let Err(error) = job.assign(process.get()) {
        terminate_suspended(process.get());
        return Err(error);
    }
    if unsafe { ResumeThread(thread.get()) } == u32::MAX {
        terminate_suspended(process.get());
        return Err(super::util::last_error(
            "worker_resume_failed",
            "Could not resume protected command worker after job assignment.",
        ));
    }
    drop(thread);
    Ok(WorkerProcess { process, _job: job })
}

struct AclLease {
    roots: Vec<PathBuf>,
    capability: Vec<u8>,
    released: bool,
}

impl AclLease {
    fn acquire(roots: Vec<PathBuf>, base: &[u8], capability: &[u8]) -> AppResult<Self> {
        let mut lease = Self {
            roots: Vec::new(),
            capability: capability.to_vec(),
            released: false,
        };
        for root in roots {
            let canonical = std::fs::canonicalize(&root).map_err(|error| {
                AppError::io(
                    &format!("Could not resolve writable location {}", root.display()),
                    error,
                )
            })?;
            grant_modify(&canonical, base)?;
            lease.roots.push(canonical.clone());
            if let Err(error) = grant_modify(&canonical, capability) {
                let _ = lease.release();
                return Err(error);
            }
        }
        Ok(lease)
    }

    fn release(&mut self) -> AppResult<()> {
        if self.released {
            return Ok(());
        }
        let mut failure = None;
        for root in &self.roots {
            if let Err(error) = revoke(root, &self.capability) {
                if failure.is_none() {
                    failure = Some(error);
                }
            }
        }
        self.released = true;
        match failure {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

impl Drop for AclLease {
    fn drop(&mut self) {
        let _ = self.release();
    }
}

fn create_capability_sid() -> AppResult<String> {
    let random = random_hex(16)?;
    let values = (0..4)
        .map(|index| u32::from_str_radix(&random[index * 8..index * 8 + 8], 16))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| AppError::windows("capability_sid_failed", error.to_string()))?;
    Ok(format!(
        "S-1-5-21-{}-{}-{}-{}",
        values[0], values[1], values[2], values[3]
    ))
}

fn validate_runtime_paths(policy: &SandboxPolicy) -> AppResult<()> {
    if !policy.cwd.is_dir() {
        return Err(AppError::invalid(
            "Policy cwd must be an existing directory.",
        ));
    }
    if !policy.runtime_dir.is_dir() {
        return Err(AppError::invalid(
            "Policy runtime_dir must be an existing directory.",
        ));
    }
    for root in &policy.writable_roots {
        if !root.exists() {
            return Err(AppError::invalid(format!(
                "Writable location does not exist: {}.",
                root.display()
            )));
        }
    }
    Ok(())
}

fn terminate_suspended(process: windows_sys::Win32::Foundation::HANDLE) {
    unsafe {
        TerminateProcess(process, 125);
        WaitForSingleObject(process, 30000);
    }
}
