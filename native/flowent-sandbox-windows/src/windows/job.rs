use std::ffi::c_void;
use std::mem::size_of;

use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_BREAKAWAY_OK,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject,
};

use crate::error::AppResult;

use super::util::{OwnedHandle, last_error};

pub struct KillJob {
    handle: OwnedHandle,
}

impl KillJob {
    pub fn create() -> AppResult<Self> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        let handle =
            OwnedHandle::new(handle, "job_create_failed", "Could not create process job.")?;
        let mut information = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let flags = information.BasicLimitInformation.LimitFlags;
        if flags & (JOB_OBJECT_LIMIT_BREAKAWAY_OK | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK) != 0 {
            return Err(crate::error::AppError::windows(
                "job_configuration_failed",
                "Unsafe process breakaway flags were rejected.",
            ));
        }
        if unsafe {
            SetInformationJobObject(
                handle.get(),
                JobObjectExtendedLimitInformation,
                &information as *const _ as *const c_void,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        } == 0
        {
            return Err(last_error(
                "job_configuration_failed",
                "Could not secure process job.",
            ));
        }
        Ok(Self { handle })
    }

    pub fn assign(&self, process: HANDLE) -> AppResult<()> {
        if unsafe { AssignProcessToJobObject(self.handle.get(), process) } == 0 {
            return Err(last_error(
                "job_assignment_failed",
                "Could not attach suspended process to its secured job.",
            ));
        }
        Ok(())
    }
}
