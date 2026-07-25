use std::ffi::c_void;

use windows_sys::Win32::Foundation::{ERROR_SUCCESS, LocalFree};
use windows_sys::Win32::Security::Authorization::{
    EXPLICIT_ACCESS_W, GRANT_ACCESS, SE_WINDOW_OBJECT, SetEntriesInAclW, SetSecurityInfo,
    TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::DACL_SECURITY_INFORMATION;
use windows_sys::Win32::System::StationsAndDesktops::{
    CloseDesktop, CreateDesktopW, DESKTOP_CREATEMENU, DESKTOP_CREATEWINDOW, DESKTOP_DELETE,
    DESKTOP_ENUMERATE, DESKTOP_HOOKCONTROL, DESKTOP_JOURNALPLAYBACK, DESKTOP_JOURNALRECORD,
    DESKTOP_READ_CONTROL, DESKTOP_READOBJECTS, DESKTOP_SWITCHDESKTOP, DESKTOP_WRITE_DAC,
    DESKTOP_WRITE_OWNER, DESKTOP_WRITEOBJECTS, HDESK,
};

use crate::error::{AppError, AppResult};

use super::util::{sid_from_string, wide};

const DESKTOP_ACCESS: u32 = DESKTOP_READOBJECTS
    | DESKTOP_CREATEWINDOW
    | DESKTOP_CREATEMENU
    | DESKTOP_HOOKCONTROL
    | DESKTOP_JOURNALRECORD
    | DESKTOP_JOURNALPLAYBACK
    | DESKTOP_ENUMERATE
    | DESKTOP_WRITEOBJECTS
    | DESKTOP_SWITCHDESKTOP
    | DESKTOP_DELETE
    | DESKTOP_READ_CONTROL
    | DESKTOP_WRITE_DAC
    | DESKTOP_WRITE_OWNER;

pub struct PrivateDesktop {
    handle: HDESK,
    startup_name: Vec<u16>,
}

impl PrivateDesktop {
    pub fn create(name_suffix: &str, base_sid: &str, capability_sid: &str) -> AppResult<Self> {
        let name = format!("FlowentProtected-{name_suffix}");
        let name_wide = wide(&name);
        let handle = unsafe {
            CreateDesktopW(
                name_wide.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                DESKTOP_ACCESS,
                std::ptr::null(),
            )
        };
        if handle.is_null() {
            return Err(super::util::last_error(
                "desktop_create_failed",
                "Could not create private command desktop.",
            ));
        }
        let base = sid_from_string(base_sid)?;
        let capability = sid_from_string(capability_sid)?;
        if let Err(error) = apply_acl(handle, &[&base, &capability]) {
            unsafe {
                CloseDesktop(handle);
            }
            return Err(error);
        }
        Ok(Self {
            handle,
            startup_name: wide(format!("Winsta0\\{name}")),
        })
    }

    pub fn startup_name(&mut self) -> *mut u16 {
        self.startup_name.as_mut_ptr()
    }
}

impl Drop for PrivateDesktop {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe {
                CloseDesktop(self.handle);
            }
        }
    }
}

fn apply_acl(handle: HDESK, sids: &[&Vec<u8>]) -> AppResult<()> {
    let entries = sids
        .iter()
        .map(|sid| EXPLICIT_ACCESS_W {
            grfAccessPermissions: DESKTOP_ACCESS,
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: 0,
            Trustee: TRUSTEE_W {
                pMultipleTrustee: std::ptr::null_mut(),
                MultipleTrusteeOperation: 0,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_UNKNOWN,
                ptstrName: sid.as_ptr() as *mut c_void as *mut u16,
            },
        })
        .collect::<Vec<_>>();
    let mut acl = std::ptr::null_mut();
    let status = unsafe {
        SetEntriesInAclW(
            entries.len() as u32,
            entries.as_ptr(),
            std::ptr::null_mut(),
            &mut acl,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(AppError::windows(
            "desktop_acl_failed",
            format!("Could not prepare private desktop access: {status}."),
        ));
    }
    let status = unsafe {
        SetSecurityInfo(
            handle,
            SE_WINDOW_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            acl,
            std::ptr::null_mut(),
        )
    };
    unsafe {
        LocalFree(acl as *mut c_void);
    }
    if status != ERROR_SUCCESS {
        return Err(AppError::windows(
            "desktop_acl_failed",
            format!("Could not apply private desktop access: {status}."),
        ));
    }
    Ok(())
}
