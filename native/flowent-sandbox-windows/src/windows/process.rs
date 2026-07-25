use std::mem::size_of;
use std::path::Path;

use windows_sys::Win32::Foundation::{HANDLE_FLAG_INHERIT, SetHandleInformation, WAIT_OBJECT_0};
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
use windows_sys::Win32::Storage::FileSystem::ReadFile;
use windows_sys::Win32::System::Pipes::CreatePipe;
use windows_sys::Win32::System::Threading::{
    CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateProcessAsUserW, GetExitCodeProcess,
    INFINITE, PROCESS_INFORMATION, ResumeThread, STARTF_USESTDHANDLES, STARTUPINFOW,
    TerminateProcess, WaitForSingleObject,
};

use crate::error::{AppError, AppResult};

use super::desktop::PrivateDesktop;
use super::job::KillJob;
use super::token::create_restricted;
use super::util::{OwnedHandle, last_error, quote_command, random_hex, wide_path};

pub struct ProtectedProcess {
    process: OwnedHandle,
    _job: KillJob,
    _desktop: PrivateDesktop,
    stdout: Option<OwnedHandle>,
    stderr: Option<OwnedHandle>,
    pub process_id: u32,
}

impl ProtectedProcess {
    pub fn take_stdout(&mut self) -> AppResult<OwnedHandle> {
        self.stdout.take().ok_or_else(|| {
            AppError::windows(
                "stdio_pipe_failed",
                "Protected stdout was already consumed.",
            )
        })
    }

    pub fn take_stderr(&mut self) -> AppResult<OwnedHandle> {
        self.stderr.take().ok_or_else(|| {
            AppError::windows(
                "stdio_pipe_failed",
                "Protected stderr was already consumed.",
            )
        })
    }

    pub fn wait(self) -> AppResult<i32> {
        let wait = unsafe { WaitForSingleObject(self.process.get(), INFINITE) };
        if wait != WAIT_OBJECT_0 {
            return Err(last_error(
                "process_wait_failed",
                "Could not wait for protected command.",
            ));
        }
        let mut exit_code = 0u32;
        if unsafe { GetExitCodeProcess(self.process.get(), &mut exit_code) } == 0 {
            return Err(last_error(
                "process_status_failed",
                "Could not read protected command result.",
            ));
        }
        Ok(exit_code as i32)
    }
}

pub fn spawn(
    command: &[String],
    cwd: &Path,
    base_sid: &str,
    capability_sid: &str,
    mut progress: impl FnMut(&'static str) -> AppResult<()>,
) -> AppResult<ProtectedProcess> {
    let token = create_restricted(capability_sid)?;
    progress("restricted_token_ready")?;
    let mut desktop = PrivateDesktop::create(&random_hex(16)?, base_sid, capability_sid)?;
    progress("private_desktop_ready")?;
    let (stdin_read, stdin_write) = inheritable_pipe()?;
    let (stdout_read, stdout_write) = inheritable_pipe()?;
    let (stderr_read, stderr_write) = inheritable_pipe()?;
    clear_inheritance(stdin_write.get())?;
    clear_inheritance(stdout_read.get())?;
    clear_inheritance(stderr_read.get())?;
    progress("stdio_ready")?;
    let mut startup = STARTUPINFOW::default();
    startup.cb = size_of::<STARTUPINFOW>() as u32;
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.lpDesktop = desktop.startup_name();
    startup.hStdInput = stdin_read.get();
    startup.hStdOutput = stdout_write.get();
    startup.hStdError = stderr_write.get();
    let mut information = PROCESS_INFORMATION::default();
    let mut command_line = quote_command(command)?;
    let cwd_wide = wide_path(cwd);
    let creation_flags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT;
    if unsafe {
        CreateProcessAsUserW(
            token.get(),
            std::ptr::null(),
            command_line.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
            creation_flags,
            std::ptr::null(),
            cwd_wide.as_ptr(),
            &startup,
            &mut information,
        )
    } == 0
    {
        return Err(last_error(
            "process_create_failed",
            "Could not create suspended protected command.",
        ));
    }
    let process = OwnedHandle::new(
        information.hProcess,
        "process_create_failed",
        "Could not open protected command process.",
    )?;
    let thread = OwnedHandle::new(
        information.hThread,
        "process_create_failed",
        "Could not open protected command thread.",
    )?;
    if let Err(error) = progress("command_created") {
        terminate_suspended(process.get());
        return Err(error);
    }
    drop(stdin_read);
    drop(stdin_write);
    drop(stdout_write);
    drop(stderr_write);
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
    if let Err(error) = progress("command_job_assigned") {
        terminate_suspended(process.get());
        return Err(error);
    }
    if unsafe { ResumeThread(thread.get()) } == u32::MAX {
        terminate_suspended(process.get());
        return Err(last_error(
            "process_resume_failed",
            "Could not resume protected command after job assignment.",
        ));
    }
    if let Err(error) = progress("command_resumed") {
        unsafe {
            TerminateProcess(process.get(), 125);
            WaitForSingleObject(process.get(), INFINITE);
        }
        return Err(error);
    }
    drop(thread);
    Ok(ProtectedProcess {
        process,
        _job: job,
        _desktop: desktop,
        stdout: Some(stdout_read),
        stderr: Some(stderr_read),
        process_id: information.dwProcessId,
    })
}

pub fn read_output<F>(
    handle: OwnedHandle,
    mut callback: F,
) -> std::thread::JoinHandle<AppResult<()>>
where
    F: FnMut(String) -> AppResult<()> + Send + 'static,
{
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            let mut read = 0u32;
            let result = unsafe {
                ReadFile(
                    handle.get(),
                    buffer.as_mut_ptr(),
                    buffer.len() as u32,
                    &mut read,
                    std::ptr::null_mut(),
                )
            };
            if result == 0 || read == 0 {
                break;
            }
            callback(String::from_utf8_lossy(&buffer[..read as usize]).into_owned())?;
        }
        Ok(())
    })
}

fn inheritable_pipe() -> AppResult<(OwnedHandle, OwnedHandle)> {
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: std::ptr::null_mut(),
        bInheritHandle: 1,
    };
    let mut read = std::ptr::null_mut();
    let mut write = std::ptr::null_mut();
    if unsafe { CreatePipe(&mut read, &mut write, &attributes, 0) } == 0 {
        return Err(last_error(
            "stdio_pipe_failed",
            "Could not create protected command output channel.",
        ));
    }
    Ok((
        OwnedHandle::new(
            read,
            "stdio_pipe_failed",
            "Could not open command output channel.",
        )?,
        OwnedHandle::new(
            write,
            "stdio_pipe_failed",
            "Could not open command output channel.",
        )?,
    ))
}

fn clear_inheritance(handle: windows_sys::Win32::Foundation::HANDLE) -> AppResult<()> {
    if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) } == 0 {
        return Err(last_error(
            "stdio_pipe_failed",
            "Could not secure protected command output handle.",
        ));
    }
    Ok(())
}

fn terminate_suspended(process: windows_sys::Win32::Foundation::HANDLE) {
    unsafe {
        TerminateProcess(process, 125);
        WaitForSingleObject(process, INFINITE);
    }
}
