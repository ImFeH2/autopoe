use windows_sys::Win32::Foundation::{WAIT_ABANDONED, WAIT_OBJECT_0};
use windows_sys::Win32::System::Threading::{
    CreateMutexW, INFINITE, ReleaseMutex, WaitForSingleObject,
};

use crate::error::{AppError, AppResult};

use super::util::{OwnedHandle, wide};

pub struct AclLock {
    handle: OwnedHandle,
}

impl AclLock {
    pub fn acquire() -> AppResult<Self> {
        let name = wide("Local\\FlowentSandboxAcl");
        let handle = unsafe { CreateMutexW(std::ptr::null_mut(), 0, name.as_ptr()) };
        let handle = OwnedHandle::new(
            handle,
            "acl_lock_failed",
            "Could not open command protection access lock.",
        )?;
        let result = unsafe { WaitForSingleObject(handle.get(), INFINITE) };
        if result != WAIT_OBJECT_0 && result != WAIT_ABANDONED {
            return Err(AppError::windows(
                "acl_lock_failed",
                "Could not acquire command protection access lock.",
            ));
        }
        Ok(Self { handle })
    }
}

impl Drop for AclLock {
    fn drop(&mut self) {
        unsafe {
            ReleaseMutex(self.handle.get());
        }
    }
}
