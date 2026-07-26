use std::ffi::c_void;
use std::mem::size_of;

use windows_sys::Win32::Foundation::{ERROR_SUCCESS, LocalFree};
use windows_sys::Win32::Security::Authorization::{
    EXPLICIT_ACCESS_W, GRANT_ACCESS, SetEntriesInAclW, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN,
    TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    ACL, InitializeSecurityDescriptor, SECURITY_ATTRIBUTES, SECURITY_DESCRIPTOR,
    SetSecurityDescriptorDacl,
};
use windows_sys::Win32::System::StationsAndDesktops::{
    CloseDesktop, CreateDesktopW, DESKTOP_CREATEMENU, DESKTOP_CREATEWINDOW, DESKTOP_DELETE,
    DESKTOP_ENUMERATE, DESKTOP_HOOKCONTROL, DESKTOP_JOURNALPLAYBACK, DESKTOP_JOURNALRECORD,
    DESKTOP_READ_CONTROL, DESKTOP_READOBJECTS, DESKTOP_SWITCHDESKTOP, DESKTOP_WRITE_DAC,
    DESKTOP_WRITE_OWNER, DESKTOP_WRITEOBJECTS, GetProcessWindowStation, GetUserObjectInformationW,
    HDESK, HWINSTA, UOI_NAME,
};
use windows_sys::Win32::System::SystemServices::SECURITY_DESCRIPTOR_REVISION;

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
    pub fn create(
        name_suffix: &str,
        base_sid: &str,
        capability_sid: &str,
        logon_sid: &[u8],
    ) -> AppResult<Self> {
        let base = sid_from_string(base_sid)?;
        let capability = sid_from_string(capability_sid)?;
        let sids = [&base[..], &capability[..], logon_sid];
        let station = unsafe { GetProcessWindowStation() };
        if station.is_null() {
            return Err(super::util::last_error(
                "window_station_name_failed",
                "Could not access the current command window station.",
            ));
        }
        let station_name = user_object_name(station)?;
        let desktop_name = format!("FlowentProtectedDesktop-{name_suffix}");
        let name_wide = wide(&desktop_name);
        let acl = create_acl(&sids, DESKTOP_ACCESS)?;
        let mut descriptor = create_descriptor(&acl)?;
        let attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: &mut descriptor as *mut _ as *mut c_void,
            bInheritHandle: 0,
        };
        let handle = unsafe {
            CreateDesktopW(
                name_wide.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                DESKTOP_ACCESS,
                &attributes,
            )
        };
        if handle.is_null() {
            return Err(super::util::last_error(
                "desktop_create_failed",
                "Could not create private command desktop.",
            ));
        }
        Ok(Self {
            handle,
            startup_name: wide(format!("{station_name}\\{desktop_name}")),
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

struct LocalAcl(*mut ACL);

impl LocalAcl {
    fn get(&self) -> *mut ACL {
        self.0
    }
}

impl Drop for LocalAcl {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0 as *mut c_void);
        }
    }
}

fn create_acl(sids: &[&[u8]], access: u32) -> AppResult<LocalAcl> {
    let entries = sids
        .iter()
        .map(|sid| EXPLICIT_ACCESS_W {
            grfAccessPermissions: access,
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
            "user_object_acl_failed",
            format!("Could not prepare private command access: {status}."),
        ));
    }
    Ok(LocalAcl(acl))
}

fn create_descriptor(acl: &LocalAcl) -> AppResult<SECURITY_DESCRIPTOR> {
    let mut descriptor = SECURITY_DESCRIPTOR::default();
    if unsafe {
        InitializeSecurityDescriptor(
            &mut descriptor as *mut _ as *mut c_void,
            SECURITY_DESCRIPTOR_REVISION,
        )
    } == 0
    {
        return Err(super::util::last_error(
            "user_object_acl_failed",
            "Could not initialize private command access.",
        ));
    }
    if unsafe {
        SetSecurityDescriptorDacl(&mut descriptor as *mut _ as *mut c_void, 1, acl.get(), 0)
    } == 0
    {
        return Err(super::util::last_error(
            "user_object_acl_failed",
            "Could not apply private command access.",
        ));
    }
    Ok(descriptor)
}

fn user_object_name(handle: HWINSTA) -> AppResult<String> {
    let mut needed = 0u32;
    unsafe {
        GetUserObjectInformationW(handle, UOI_NAME, std::ptr::null_mut(), 0, &mut needed);
    }
    if needed < size_of::<u16>() as u32 {
        return Err(super::util::last_error(
            "window_station_name_failed",
            "Could not read the current command window station name.",
        ));
    }
    let mut buffer = vec![0u16; (needed as usize).div_ceil(size_of::<u16>())];
    if unsafe {
        GetUserObjectInformationW(
            handle,
            UOI_NAME,
            buffer.as_mut_ptr() as *mut c_void,
            (buffer.len() * size_of::<u16>()) as u32,
            &mut needed,
        )
    } == 0
    {
        return Err(super::util::last_error(
            "window_station_name_failed",
            "Could not read the current command window station name.",
        ));
    }
    let length = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());
    let name = String::from_utf16(&buffer[..length])
        .map_err(|error| AppError::windows("window_station_name_failed", error.to_string()))?;
    if name.is_empty() || name.contains('\\') {
        return Err(AppError::windows(
            "window_station_name_failed",
            "Current command window station name is invalid.",
        ));
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use windows_sys::Win32::System::StationsAndDesktops::GetProcessWindowStation;

    use super::{PrivateDesktop, user_object_name};
    use crate::windows::token::create_restricted;

    #[test]
    fn creates_private_desktop_on_current_window_station() {
        let capability = "S-1-5-21-1-2-3-4";
        let identity = create_restricted(capability).unwrap();
        let station = user_object_name(unsafe { GetProcessWindowStation() }).unwrap();
        let desktop =
            PrivateDesktop::create("test", "S-1-1-0", capability, &identity.logon_sid).unwrap();
        let length = desktop
            .startup_name
            .iter()
            .position(|value| *value == 0)
            .unwrap();
        let name = String::from_utf16(&desktop.startup_name[..length]).unwrap();

        assert!(name.starts_with(&format!("{station}\\FlowentProtectedDesktop-")));
        assert!(!name.ends_with("\\Default"));
    }
}
