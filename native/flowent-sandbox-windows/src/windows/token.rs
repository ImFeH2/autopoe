use std::ffi::c_void;

use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::Security::{
    CreateRestrictedToken, DISABLE_MAX_PRIVILEGE, GetTokenInformation, IsTokenRestricted,
    LUA_TOKEN, SID_AND_ATTRIBUTES, TOKEN_ADJUST_DEFAULT, TOKEN_ADJUST_SESSIONID,
    TOKEN_ASSIGN_PRIMARY, TOKEN_DUPLICATE, TOKEN_QUERY, TOKEN_USER, TokenUser, WRITE_RESTRICTED,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

use crate::error::{AppError, AppResult};

use super::util::{OwnedHandle, copy_sid, last_error, sid_from_string, sid_to_string};

pub fn create_restricted(capability_sid: &str) -> AppResult<OwnedHandle> {
    let capability = sid_from_string(capability_sid)?;
    let mut current = std::ptr::null_mut();
    let access = TOKEN_ASSIGN_PRIMARY
        | TOKEN_DUPLICATE
        | TOKEN_QUERY
        | TOKEN_ADJUST_DEFAULT
        | TOKEN_ADJUST_SESSIONID;
    if unsafe { OpenProcessToken(GetCurrentProcess(), access, &mut current) } == 0 {
        return Err(last_error(
            "token_open_failed",
            "Could not open protected account identity.",
        ));
    }
    let current = OwnedHandle::new(
        current,
        "token_open_failed",
        "Could not open account identity.",
    )?;
    let restricting = SID_AND_ATTRIBUTES {
        Sid: capability.as_ptr() as *mut c_void,
        Attributes: 0,
    };
    let mut restricted: HANDLE = std::ptr::null_mut();
    let flags = DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED;
    if unsafe {
        CreateRestrictedToken(
            current.get(),
            flags,
            0,
            std::ptr::null(),
            0,
            std::ptr::null(),
            1,
            &restricting,
            &mut restricted,
        )
    } == 0
    {
        return Err(last_error(
            "token_restriction_failed",
            "Could not create restricted command identity.",
        ));
    }
    let restricted = OwnedHandle::new(
        restricted,
        "token_restriction_failed",
        "Could not create restricted identity.",
    )?;
    if unsafe { IsTokenRestricted(restricted.get()) } == 0 {
        return Err(AppError::windows(
            "token_restriction_failed",
            "Windows did not mark the command identity as restricted.",
        ));
    }
    Ok(restricted)
}

pub fn verify_current_account(expected_sid: &str, expected_group_sid: &str) -> AppResult<()> {
    let mut current = std::ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut current) } == 0 {
        return Err(last_error(
            "worker_identity_failed",
            "Could not inspect protected command worker identity.",
        ));
    }
    let current = OwnedHandle::new(
        current,
        "worker_identity_failed",
        "Could not inspect worker identity.",
    )?;
    let mut length = 0u32;
    unsafe {
        GetTokenInformation(
            current.get(),
            TokenUser,
            std::ptr::null_mut(),
            0,
            &mut length,
        );
    }
    if length == 0 {
        return Err(last_error(
            "worker_identity_failed",
            "Could not size worker identity.",
        ));
    }
    let mut buffer = vec![0u8; length as usize];
    if unsafe {
        GetTokenInformation(
            current.get(),
            TokenUser,
            buffer.as_mut_ptr() as *mut c_void,
            length,
            &mut length,
        )
    } == 0
    {
        return Err(last_error(
            "worker_identity_failed",
            "Could not read worker identity.",
        ));
    }
    let user = unsafe { &*(buffer.as_ptr() as *const TOKEN_USER) };
    let actual = sid_to_string(&copy_sid(user.User.Sid)?)?;
    if !actual.eq_ignore_ascii_case(expected_sid) {
        return Err(AppError::windows(
            "worker_identity_failed",
            "Protected command worker started under an unexpected account.",
        ));
    }
    let group = sid_from_string(expected_group_sid)?;
    let mut member = 0;
    if unsafe {
        windows_sys::Win32::Security::CheckTokenMembership(
            current.get(),
            group.as_ptr() as *mut c_void,
            &mut member,
        )
    } == 0
        || member == 0
    {
        return Err(AppError::windows(
            "worker_identity_failed",
            "Protected command worker is not in its required account group.",
        ));
    }
    Ok(())
}
