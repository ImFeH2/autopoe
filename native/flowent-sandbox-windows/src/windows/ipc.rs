use serde::Serialize;
use serde::de::DeserializeOwned;
use std::ffi::c_void;

use windows_sys::Win32::Foundation::{
    ERROR_BROKEN_PIPE, ERROR_NO_DATA, ERROR_PIPE_BUSY, ERROR_PIPE_CONNECTED, ERROR_PIPE_LISTENING,
    GENERIC_READ, GENERIC_WRITE, GetLastError, LocalFree, WAIT_OBJECT_0,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_FLAG_FIRST_PIPE_INSTANCE, FlushFileBuffers, OPEN_EXISTING,
    PIPE_ACCESS_DUPLEX, ReadFile, WriteFile,
};
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, PIPE_NOWAIT, PIPE_READMODE_BYTE,
    PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_WAIT, SetNamedPipeHandleState, WaitNamedPipeW,
};
use windows_sys::Win32::System::Threading::WaitForSingleObject;

use crate::error::{AppError, AppResult};

use super::util::{OwnedHandle, last_error, random_hex, wide};

const MAX_FRAME_SIZE: usize = 8 * 1024 * 1024;

pub struct Pipe {
    handle: OwnedHandle,
}

impl Pipe {
    pub fn create_server(owner_sid: &str, account_sid: &str) -> AppResult<(Self, String)> {
        let name = format!(r"\\.\pipe\flowent-protected-{}", random_hex(24)?);
        let descriptor_text =
            format!("D:P(A;;GA;;;{owner_sid})(A;;GA;;;{account_sid})(A;;GA;;;SY)");
        let descriptor_wide = wide(descriptor_text);
        let mut descriptor = std::ptr::null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                descriptor_wide.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(last_error(
                "ipc_acl_failed",
                "Could not create protected communication access rules.",
            ));
        }
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        let name_wide = wide(&name);
        let handle = unsafe {
            CreateNamedPipeW(
                name_wide.as_ptr(),
                PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                65536,
                65536,
                30000,
                &attributes,
            )
        };
        unsafe {
            LocalFree(descriptor as *mut c_void);
        }
        let handle = OwnedHandle::new(
            handle,
            "ipc_create_failed",
            "Could not create protected communication channel.",
        )?;
        Ok((Self { handle }, name))
    }

    pub fn connect_server(
        &self,
        worker_process: windows_sys::Win32::Foundation::HANDLE,
    ) -> AppResult<()> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            if unsafe { ConnectNamedPipe(self.handle.get(), std::ptr::null_mut()) } != 0 {
                break;
            }
            let error = unsafe { GetLastError() };
            if error == ERROR_PIPE_CONNECTED {
                break;
            }
            if error != ERROR_PIPE_LISTENING && error != ERROR_NO_DATA {
                return Err(AppError::windows(
                    "ipc_connect_failed",
                    format!("Could not connect protected command worker: {error}."),
                ));
            }
            if unsafe { WaitForSingleObject(worker_process, 0) } == WAIT_OBJECT_0 {
                return Err(AppError::windows(
                    "worker_start_failed",
                    "Protected command worker exited before connecting.",
                ));
            }
            if std::time::Instant::now() >= deadline {
                return Err(AppError::windows(
                    "ipc_connect_failed",
                    "Timed out waiting for protected command worker.",
                ));
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let mode = PIPE_READMODE_BYTE | PIPE_WAIT;
        if unsafe {
            SetNamedPipeHandleState(self.handle.get(), &mode, std::ptr::null(), std::ptr::null())
        } == 0
        {
            return Err(last_error(
                "ipc_connect_failed",
                "Could not switch protected communication channel to blocking mode.",
            ));
        }
        Ok(())
    }

    pub fn connect_client(name: &str) -> AppResult<Self> {
        let name_wide = wide(name);
        for _ in 0..3 {
            let handle = unsafe {
                CreateFileW(
                    name_wide.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    0,
                    std::ptr::null(),
                    OPEN_EXISTING,
                    0,
                    std::ptr::null_mut(),
                )
            };
            if !handle.is_null() && handle != windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
                return Ok(Self {
                    handle: OwnedHandle::new(
                        handle,
                        "ipc_connect_failed",
                        "Could not open protected communication channel.",
                    )?,
                });
            }
            let error = unsafe { GetLastError() };
            if error != ERROR_PIPE_BUSY {
                return Err(AppError::windows(
                    "ipc_connect_failed",
                    format!("Could not open protected communication channel: {error}."),
                ));
            }
            if unsafe { WaitNamedPipeW(name_wide.as_ptr(), 10000) } == 0 {
                return Err(last_error(
                    "ipc_connect_failed",
                    "Timed out waiting for protected communication channel.",
                ));
            }
        }
        Err(AppError::windows(
            "ipc_connect_failed",
            "Could not connect protected communication channel.",
        ))
    }

    pub fn send<T: Serialize>(&mut self, value: &T) -> AppResult<()> {
        let payload = serde_json::to_vec(value)
            .map_err(|error| AppError::windows("ipc_serialization_failed", error.to_string()))?;
        if payload.len() > MAX_FRAME_SIZE {
            return Err(AppError::invalid("Protected command message is too large."));
        }
        let length = (payload.len() as u32).to_le_bytes();
        self.write_all(&length)?;
        self.write_all(&payload)?;
        if unsafe { FlushFileBuffers(self.handle.get()) } == 0 {
            return Err(last_error(
                "ipc_write_failed",
                "Could not flush protected communication channel.",
            ));
        }
        Ok(())
    }

    pub fn receive<T: DeserializeOwned>(&mut self) -> AppResult<T> {
        let mut length = [0u8; 4];
        self.read_exact(&mut length)?;
        let length = u32::from_le_bytes(length) as usize;
        if length == 0 || length > MAX_FRAME_SIZE {
            return Err(AppError::invalid(
                "Protected command message length is invalid.",
            ));
        }
        let mut payload = vec![0u8; length];
        self.read_exact(&mut payload)?;
        serde_json::from_slice(&payload).map_err(|error| {
            AppError::invalid(format!("Invalid protected command message: {error}"))
        })
    }

    fn read_exact(&self, output: &mut [u8]) -> AppResult<()> {
        let mut offset = 0usize;
        while offset < output.len() {
            let mut read = 0u32;
            let result = unsafe {
                ReadFile(
                    self.handle.get(),
                    output[offset..].as_mut_ptr(),
                    (output.len() - offset) as u32,
                    &mut read,
                    std::ptr::null_mut(),
                )
            };
            if result == 0 || read == 0 {
                let error = unsafe { GetLastError() };
                let code = if error == ERROR_BROKEN_PIPE {
                    "ipc_closed"
                } else {
                    "ipc_read_failed"
                };
                return Err(AppError::windows(
                    code,
                    format!("Protected communication channel closed: {error}."),
                ));
            }
            offset += read as usize;
        }
        Ok(())
    }

    fn write_all(&self, input: &[u8]) -> AppResult<()> {
        let mut offset = 0usize;
        while offset < input.len() {
            let mut written = 0u32;
            if unsafe {
                WriteFile(
                    self.handle.get(),
                    input[offset..].as_ptr(),
                    (input.len() - offset) as u32,
                    &mut written,
                    std::ptr::null_mut(),
                )
            } == 0
            {
                return Err(last_error(
                    "ipc_write_failed",
                    "Could not write protected communication channel.",
                ));
            }
            if written == 0 {
                return Err(AppError::windows(
                    "ipc_write_failed",
                    "Protected communication channel accepted no data.",
                ));
            }
            offset += written as usize;
        }
        Ok(())
    }
}
