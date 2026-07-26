use std::ffi::c_void;
use std::mem::{align_of, size_of};

use windows_sys::Win32::Foundation::{
    ERROR_NOT_ALL_ASSIGNED, ERROR_SUCCESS, GENERIC_ALL, GetLastError, HANDLE, LUID, LocalFree,
};
use windows_sys::Win32::Security::Authorization::{
    EXPLICIT_ACCESS_W, GRANT_ACCESS, SetEntriesInAclW, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN,
    TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    AdjustTokenPrivileges, CreateRestrictedToken, DISABLE_MAX_PRIVILEGE, GetTokenInformation,
    IsTokenRestricted, LUA_TOKEN, LUID_AND_ATTRIBUTES, LookupPrivilegeValueW, SE_PRIVILEGE_ENABLED,
    SID_AND_ATTRIBUTES, SetTokenInformation, TOKEN_ADJUST_DEFAULT, TOKEN_ADJUST_PRIVILEGES,
    TOKEN_ADJUST_SESSIONID, TOKEN_ASSIGN_PRIMARY, TOKEN_DEFAULT_DACL, TOKEN_DUPLICATE,
    TOKEN_INFORMATION_CLASS, TOKEN_PRIVILEGES, TOKEN_QUERY, TOKEN_USER, TokenDefaultDacl,
    TokenGroups, TokenUser, WRITE_RESTRICTED,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

use crate::error::{AppError, AppResult};

use super::util::{
    OwnedHandle, copy_sid, last_error, sid_from_string, sid_to_string, token_has_enabled_sid,
};

const SE_GROUP_LOGON_ID: u32 = 0xC0000000;

pub struct RestrictedIdentity {
    pub token: OwnedHandle,
    pub logon_sid: Vec<u8>,
}

pub fn create_restricted(capability_sid: &str) -> AppResult<RestrictedIdentity> {
    let capability = sid_from_string(capability_sid)?;
    let everyone = sid_from_string("S-1-1-0")?;
    let mut current = std::ptr::null_mut();
    let access = TOKEN_ASSIGN_PRIMARY
        | TOKEN_DUPLICATE
        | TOKEN_QUERY
        | TOKEN_ADJUST_DEFAULT
        | TOKEN_ADJUST_PRIVILEGES
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
    let logon_sid = token_logon_sid(&current)?;
    let restricting = [
        SID_AND_ATTRIBUTES {
            Sid: capability.as_ptr() as *mut c_void,
            Attributes: 0,
        },
        SID_AND_ATTRIBUTES {
            Sid: logon_sid.as_ptr() as *mut c_void,
            Attributes: 0,
        },
        SID_AND_ATTRIBUTES {
            Sid: everyone.as_ptr() as *mut c_void,
            Attributes: 0,
        },
    ];
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
            restricting.len() as u32,
            restricting.as_ptr(),
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
    enable_privilege(&restricted, "SeChangeNotifyPrivilege")?;
    grant_default_object_access(&restricted, &[&capability, &logon_sid, &everyone])?;
    Ok(RestrictedIdentity {
        token: restricted,
        logon_sid,
    })
}

fn enable_privilege(token: &OwnedHandle, name: &str) -> AppResult<()> {
    let luid = privilege_luid(name)?;
    let privileges = TOKEN_PRIVILEGES {
        PrivilegeCount: 1,
        Privileges: [LUID_AND_ATTRIBUTES {
            Luid: luid,
            Attributes: SE_PRIVILEGE_ENABLED,
        }],
    };
    if unsafe {
        AdjustTokenPrivileges(
            token.get(),
            0,
            &privileges,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(last_error(
            "token_privilege_failed",
            "Could not apply protected command privileges.",
        ));
    }
    if unsafe { GetLastError() } == ERROR_NOT_ALL_ASSIGNED {
        return Err(AppError::windows(
            "token_privilege_failed",
            "Required protected command privileges are unavailable.",
        ));
    }
    Ok(())
}

fn privilege_luid(name: &str) -> AppResult<LUID> {
    let name = super::util::wide(name);
    let mut luid = LUID {
        LowPart: 0,
        HighPart: 0,
    };
    if unsafe { LookupPrivilegeValueW(std::ptr::null(), name.as_ptr(), &mut luid) } == 0 {
        return Err(last_error(
            "token_privilege_failed",
            "Could not resolve protected command privileges.",
        ));
    }
    Ok(luid)
}

fn token_logon_sid(token: &OwnedHandle) -> AppResult<Vec<u8>> {
    let (buffer, length) = read_token_information(
        token,
        TokenGroups,
        "token_logon_sid_failed",
        "protected logon identity",
    )?;
    let bytes = buffer.as_ptr() as *const u8;
    let group_count = unsafe { std::ptr::read_unaligned(bytes as *const u32) } as usize;
    let group_offset = size_of::<u32>().next_multiple_of(align_of::<SID_AND_ATTRIBUTES>());
    let groups_length = group_count
        .checked_mul(size_of::<SID_AND_ATTRIBUTES>())
        .and_then(|value| value.checked_add(group_offset))
        .ok_or_else(|| {
            AppError::windows(
                "token_logon_sid_failed",
                "Protected logon identity is invalid.",
            )
        })?;
    if groups_length > length {
        return Err(AppError::windows(
            "token_logon_sid_failed",
            "Protected logon identity is invalid.",
        ));
    }
    let groups = unsafe { bytes.add(group_offset) as *const SID_AND_ATTRIBUTES };
    for index in 0..group_count {
        let group = unsafe { std::ptr::read_unaligned(groups.add(index)) };
        if group.Attributes & SE_GROUP_LOGON_ID == SE_GROUP_LOGON_ID {
            return copy_sid(group.Sid);
        }
    }
    Err(AppError::windows(
        "token_logon_sid_failed",
        "Protected logon identity is unavailable.",
    ))
}

fn grant_default_object_access(token: &OwnedHandle, sids: &[&[u8]]) -> AppResult<()> {
    let (buffer, _) = read_token_information(
        token,
        TokenDefaultDacl,
        "token_default_access_failed",
        "protected object access",
    )?;
    let current = unsafe { &*(buffer.as_ptr() as *const TOKEN_DEFAULT_DACL) };
    let entries = sids
        .iter()
        .map(|sid| EXPLICIT_ACCESS_W {
            grfAccessPermissions: GENERIC_ALL,
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
    let mut updated = std::ptr::null_mut();
    let status = unsafe {
        SetEntriesInAclW(
            entries.len() as u32,
            entries.as_ptr(),
            current.DefaultDacl,
            &mut updated,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(AppError::windows(
            "token_default_access_failed",
            format!("Could not prepare protected object access: {status}."),
        ));
    }
    let information = TOKEN_DEFAULT_DACL {
        DefaultDacl: updated,
    };
    let result = unsafe {
        SetTokenInformation(
            token.get(),
            TokenDefaultDacl,
            &information as *const _ as *const c_void,
            size_of::<TOKEN_DEFAULT_DACL>() as u32,
        )
    };
    let error = if result == 0 {
        Some(last_error(
            "token_default_access_failed",
            "Could not apply protected object access.",
        ))
    } else {
        None
    };
    unsafe {
        LocalFree(updated as *mut c_void);
    }
    match error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

fn read_token_information(
    token: &OwnedHandle,
    information_class: TOKEN_INFORMATION_CLASS,
    code: &str,
    description: &str,
) -> AppResult<(Vec<usize>, usize)> {
    let mut length = 0u32;
    unsafe {
        GetTokenInformation(
            token.get(),
            information_class,
            std::ptr::null_mut(),
            0,
            &mut length,
        );
    }
    if length == 0 {
        return Err(last_error(code, &format!("Could not size {description}.")));
    }
    let word_count = (length as usize).div_ceil(size_of::<usize>());
    let mut buffer = vec![0usize; word_count];
    if unsafe {
        GetTokenInformation(
            token.get(),
            information_class,
            buffer.as_mut_ptr() as *mut c_void,
            length,
            &mut length,
        )
    } == 0
    {
        return Err(last_error(code, &format!("Could not read {description}.")));
    }
    Ok((buffer, length as usize))
}

pub fn verify_current_account(expected_sid: &str, expected_group_sid: &str) -> AppResult<()> {
    let mut current = std::ptr::null_mut();
    if unsafe {
        OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_QUERY | TOKEN_DUPLICATE,
            &mut current,
        )
    } == 0
    {
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
    if !token_has_enabled_sid(
        &current,
        &group,
        "worker_identity_failed",
        "Could not verify protected command worker membership.",
    )? {
        return Err(AppError::windows(
            "worker_identity_failed",
            "Protected command worker is not in its required account group.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::mem::{align_of, size_of};

    use windows_sys::Win32::Security::{
        IsTokenRestricted, LUID_AND_ATTRIBUTES, SE_PRIVILEGE_ENABLED, SID_AND_ATTRIBUTES,
        TokenPrivileges, TokenRestrictedSids,
    };

    use super::{create_restricted, privilege_luid, read_token_information};
    use crate::windows::util::{copy_sid, sid_to_string};

    fn restricted_sids(identity: &super::RestrictedIdentity) -> Vec<String> {
        let (buffer, length) = read_token_information(
            &identity.token,
            TokenRestrictedSids,
            "test_failed",
            "restricted identities",
        )
        .unwrap();
        let bytes = buffer.as_ptr() as *const u8;
        let count = unsafe { std::ptr::read_unaligned(bytes as *const u32) } as usize;
        let offset = size_of::<u32>().next_multiple_of(align_of::<SID_AND_ATTRIBUTES>());
        assert!(offset + count * size_of::<SID_AND_ATTRIBUTES>() <= length);
        let entries = unsafe { bytes.add(offset) as *const SID_AND_ATTRIBUTES };
        let mut sids = (0..count)
            .map(|index| {
                let entry = unsafe { std::ptr::read_unaligned(entries.add(index)) };
                sid_to_string(&copy_sid(entry.Sid).unwrap()).unwrap()
            })
            .collect::<Vec<_>>();
        sids.sort();
        sids
    }

    fn privilege_enabled(identity: &super::RestrictedIdentity, name: &str) -> bool {
        let expected = privilege_luid(name).unwrap();
        let (buffer, length) = read_token_information(
            &identity.token,
            TokenPrivileges,
            "test_failed",
            "token privileges",
        )
        .unwrap();
        let bytes = buffer.as_ptr() as *const u8;
        let count = unsafe { std::ptr::read_unaligned(bytes as *const u32) } as usize;
        let offset = size_of::<u32>().next_multiple_of(align_of::<LUID_AND_ATTRIBUTES>());
        assert!(offset + count * size_of::<LUID_AND_ATTRIBUTES>() <= length);
        let entries = unsafe { bytes.add(offset) as *const LUID_AND_ATTRIBUTES };
        (0..count).any(|index| {
            let entry = unsafe { std::ptr::read_unaligned(entries.add(index)) };
            entry.Luid.LowPart == expected.LowPart
                && entry.Luid.HighPart == expected.HighPart
                && entry.Attributes & SE_PRIVILEGE_ENABLED != 0
        })
    }

    #[test]
    fn restricted_identity_keeps_logon_access() {
        let capability = "S-1-5-21-1-2-3-4";
        let identity = create_restricted(capability).unwrap();
        let logon_sid = sid_to_string(&identity.logon_sid).unwrap();
        let mut expected = vec![
            "S-1-1-0".to_string(),
            capability.to_string(),
            logon_sid.clone(),
        ];
        expected.sort();

        assert_ne!(unsafe { IsTokenRestricted(identity.token.get()) }, 0);
        assert!(logon_sid.starts_with("S-1-5-5-"));
        assert_eq!(restricted_sids(&identity), expected);
        assert!(privilege_enabled(&identity, "SeChangeNotifyPrivilege"));
    }
}
