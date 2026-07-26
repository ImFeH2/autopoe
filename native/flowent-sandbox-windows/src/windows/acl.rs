use std::ffi::c_void;
use std::path::Path;

use windows_sys::Win32::Foundation::{
    ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, GENERIC_ALL, GetLastError, LocalFree,
};
use windows_sys::Win32::Security::Authorization::{
    EXPLICIT_ACCESS_W, GRANT_ACCESS, GetNamedSecurityInfoW, REVOKE_ACCESS, SE_FILE_OBJECT,
    SetEntriesInAclW, SetNamedSecurityInfoW, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    ACL, DACL_SECURITY_INFORMATION, LookupAccountNameW, PROTECTED_DACL_SECURITY_INFORMATION, PSID,
    SID_NAME_USE, SUB_CONTAINERS_AND_OBJECTS_INHERIT,
};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
};

use crate::error::{AppError, AppResult};

use super::util::{copy_sid, sid_from_string, wide, wide_path};

const MODIFY_ACCESS: u32 =
    FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | 0x00010000;
const READ_EXECUTE_ACCESS: u32 = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;

pub fn lookup_sid(name: &str) -> AppResult<Vec<u8>> {
    let name_wide = wide(name);
    let mut sid_length = 0u32;
    let mut domain_length = 0u32;
    let mut sid_type: SID_NAME_USE = 0;
    unsafe {
        LookupAccountNameW(
            std::ptr::null(),
            name_wide.as_ptr(),
            std::ptr::null_mut(),
            &mut sid_length,
            std::ptr::null_mut(),
            &mut domain_length,
            &mut sid_type,
        );
    }
    if unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER {
        return Err(super::util::last_error(
            "account_lookup_failed",
            "Could not size account security identifier.",
        ));
    }
    let mut sid = vec![0u8; sid_length as usize];
    let mut domain = vec![0u16; domain_length as usize];
    if unsafe {
        LookupAccountNameW(
            std::ptr::null(),
            name_wide.as_ptr(),
            sid.as_mut_ptr() as PSID,
            &mut sid_length,
            domain.as_mut_ptr(),
            &mut domain_length,
            &mut sid_type,
        )
    } == 0
    {
        return Err(super::util::last_error(
            "account_lookup_failed",
            "Could not resolve account security identifier.",
        ));
    }
    sid.truncate(sid_length as usize);
    Ok(sid)
}

pub fn grant_modify(path: &Path, sid: &[u8]) -> AppResult<()> {
    update_path(path, sid, MODIFY_ACCESS, GRANT_ACCESS)
}

pub fn grant_read_execute(path: &Path, sid: &[u8]) -> AppResult<()> {
    update_path(path, sid, READ_EXECUTE_ACCESS, GRANT_ACCESS)
}

pub fn protect_runtime_directory(
    path: &Path,
    owner_sid: &str,
    sandbox_group_sid: &[u8],
) -> AppResult<()> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| AppError::io("Could not inspect command runtime directory", error))?;
    if metadata.file_type().is_symlink() {
        return Err(AppError::windows(
            "reparse_path_rejected",
            "Command runtime directory cannot be a symbolic link.",
        ));
    }
    let owner = sid_from_string(owner_sid)?;
    let administrators = sid_from_string("S-1-5-32-544")?;
    let system = sid_from_string("S-1-5-18")?;
    let entries = [
        explicit_access(&owner, GENERIC_ALL, GRANT_ACCESS),
        explicit_access(&administrators, GENERIC_ALL, GRANT_ACCESS),
        explicit_access(&system, GENERIC_ALL, GRANT_ACCESS),
        explicit_access(
            sandbox_group_sid,
            FILE_GENERIC_READ | FILE_GENERIC_EXECUTE,
            GRANT_ACCESS,
        ),
    ];
    replace_protected_acl(path, &entries, "runtime_acl_failed")
}

pub fn revoke(path: &Path, sid: &[u8]) -> AppResult<()> {
    update_path(path, sid, 0, REVOKE_ACCESS)
}

fn update_path(path: &Path, sid: &[u8], mask: u32, mode: i32) -> AppResult<()> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| AppError::io("Could not inspect protected path", error))?;
    if metadata.file_type().is_symlink() {
        return Err(AppError::windows(
            "reparse_path_rejected",
            format!(
                "Protected path cannot be a symbolic link: {}.",
                path.display()
            ),
        ));
    }
    let path_wide = wide_path(path);
    let mut old_acl: *mut ACL = std::ptr::null_mut();
    let mut descriptor = std::ptr::null_mut();
    let read_status = unsafe {
        GetNamedSecurityInfoW(
            path_wide.as_ptr() as *mut u16,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut old_acl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if read_status != ERROR_SUCCESS {
        return Err(AppError::windows(
            "acl_read_failed",
            format!(
                "Could not read access rules for {}: {read_status}.",
                path.display()
            ),
        ));
    }
    let entry = explicit_access(sid, mask, mode);
    let mut new_acl: *mut ACL = std::ptr::null_mut();
    let merge_status = unsafe { SetEntriesInAclW(1, &entry, old_acl, &mut new_acl) };
    if merge_status != ERROR_SUCCESS {
        unsafe {
            LocalFree(descriptor);
        }
        return Err(AppError::windows(
            "acl_update_failed",
            format!(
                "Could not prepare access rules for {}: {merge_status}.",
                path.display()
            ),
        ));
    }
    let write_status = unsafe {
        SetNamedSecurityInfoW(
            path_wide.as_ptr() as *mut u16,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            new_acl,
            std::ptr::null_mut(),
        )
    };
    unsafe {
        LocalFree(new_acl as *mut c_void);
        LocalFree(descriptor);
    }
    if write_status != ERROR_SUCCESS {
        return Err(AppError::windows(
            "acl_update_failed",
            format!(
                "Could not apply access rules for {}: {write_status}.",
                path.display()
            ),
        ));
    }
    Ok(())
}

pub fn protect_state_directory(
    path: &Path,
    owner_sid: &str,
    sandbox_group_sid: &[u8],
) -> AppResult<()> {
    let owner = sid_from_string(owner_sid)?;
    let administrators = sid_from_string("S-1-5-32-544")?;
    let system = sid_from_string("S-1-5-18")?;
    let entries = [
        explicit_access(&owner, GENERIC_ALL, GRANT_ACCESS),
        explicit_access(&administrators, GENERIC_ALL, GRANT_ACCESS),
        explicit_access(&system, GENERIC_ALL, GRANT_ACCESS),
    ];
    replace_protected_acl(path, &entries, "state_acl_failed")?;
    let group_copy = copy_sid(sandbox_group_sid.as_ptr() as PSID)?;
    if group_copy.is_empty() {
        return Err(AppError::windows(
            "state_acl_failed",
            "Could not validate protected account group.",
        ));
    }
    Ok(())
}

fn replace_protected_acl(
    path: &Path,
    entries: &[EXPLICIT_ACCESS_W],
    error_code: &str,
) -> AppResult<()> {
    let mut acl: *mut ACL = std::ptr::null_mut();
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
            error_code,
            format!("Could not prepare protected directory access: {status}."),
        ));
    }
    let path_wide = wide_path(path);
    let status = unsafe {
        SetNamedSecurityInfoW(
            path_wide.as_ptr() as *mut u16,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
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
            error_code,
            format!("Could not protect directory access: {status}."),
        ));
    }
    Ok(())
}

fn explicit_access(sid: &[u8], mask: u32, mode: i32) -> EXPLICIT_ACCESS_W {
    EXPLICIT_ACCESS_W {
        grfAccessPermissions: mask,
        grfAccessMode: mode,
        grfInheritance: SUB_CONTAINERS_AND_OBJECTS_INHERIT,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: std::ptr::null_mut(),
            MultipleTrusteeOperation: 0,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_UNKNOWN,
            ptstrName: sid.as_ptr() as *mut c_void as *mut u16,
        },
    }
}
