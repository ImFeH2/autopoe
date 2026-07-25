use std::ffi::{OsStr, c_void};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, LocalFree};
use windows_sys::Win32::Security::Authorization::{ConvertSidToStringSidW, ConvertStringSidToSidW};
use windows_sys::Win32::Security::Cryptography::{
    BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom,
};
use windows_sys::Win32::Security::{
    CheckTokenMembership, CopySid, DuplicateToken, GetLengthSid, PSID, SecurityImpersonation,
};

use crate::error::{AppError, AppResult};

pub struct OwnedHandle(HANDLE);

impl OwnedHandle {
    pub fn new(handle: HANDLE, code: &str, context: &str) -> AppResult<Self> {
        if handle.is_null() || handle == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
            return Err(last_error(code, context));
        }
        Ok(Self(handle))
    }

    pub fn get(&self) -> HANDLE {
        self.0
    }

    pub fn take(mut self) -> HANDLE {
        let handle = self.0;
        self.0 = std::ptr::null_mut();
        handle
    }
}

unsafe impl Send for OwnedHandle {}
unsafe impl Sync for OwnedHandle {}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

pub fn token_has_enabled_sid(
    token: &OwnedHandle,
    sid: &[u8],
    code: &str,
    context: &str,
) -> AppResult<bool> {
    let mut impersonation = std::ptr::null_mut();
    if unsafe { DuplicateToken(token.get(), SecurityImpersonation, &mut impersonation) } == 0 {
        return Err(last_error(code, context));
    }
    let impersonation = OwnedHandle::new(impersonation, code, context)?;
    let mut is_member = 0;
    if unsafe { CheckTokenMembership(impersonation.get(), sid.as_ptr() as PSID, &mut is_member) }
        == 0
    {
        return Err(last_error(code, context));
    }
    Ok(is_member != 0)
}

pub fn last_error(code: &str, context: &str) -> AppError {
    let value = unsafe { GetLastError() };
    AppError::windows(code, format!("{context} Windows error {value}."))
}

pub fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value
        .as_ref()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

pub fn wide_path(path: &Path) -> Vec<u16> {
    wide(path.as_os_str())
}

pub fn from_wide(pointer: *const u16) -> String {
    if pointer.is_null() {
        return String::new();
    }
    let mut length = 0usize;
    unsafe {
        while *pointer.add(length) != 0 {
            length += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(pointer, length))
    }
}

pub fn quote_command(command: &[String]) -> AppResult<Vec<u16>> {
    if command.is_empty() || command[0].is_empty() {
        return Err(AppError::invalid("Command is empty."));
    }
    let joined = command
        .iter()
        .map(|argument| quote_argument(argument))
        .collect::<Vec<_>>()
        .join(" ");
    Ok(wide(joined))
}

fn quote_argument(argument: &str) -> String {
    if !argument.is_empty()
        && !argument
            .chars()
            .any(|character| character.is_whitespace() || character == '"')
    {
        return argument.to_string();
    }
    let mut quoted = String::from("\"");
    let mut backslashes = 0usize;
    for character in argument.chars() {
        if character == '\\' {
            backslashes += 1;
            continue;
        }
        if character == '"' {
            quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
            quoted.push('"');
        } else {
            quoted.push_str(&"\\".repeat(backslashes));
            quoted.push(character);
        }
        backslashes = 0;
    }
    quoted.push_str(&"\\".repeat(backslashes * 2));
    quoted.push('"');
    quoted
}

pub fn sid_from_string(value: &str) -> AppResult<Vec<u8>> {
    let value_wide = wide(value);
    let mut pointer: PSID = std::ptr::null_mut();
    if unsafe { ConvertStringSidToSidW(value_wide.as_ptr(), &mut pointer) } == 0 {
        return Err(last_error(
            "invalid_sid",
            "Could not parse security identifier.",
        ));
    }
    let result = copy_sid(pointer);
    unsafe {
        LocalFree(pointer as *mut c_void);
    }
    result
}

pub fn sid_to_string(sid: &[u8]) -> AppResult<String> {
    let mut pointer: *mut u16 = std::ptr::null_mut();
    if unsafe { ConvertSidToStringSidW(sid.as_ptr() as PSID, &mut pointer) } == 0 {
        return Err(last_error(
            "sid_conversion_failed",
            "Could not format security identifier.",
        ));
    }
    let result = from_wide(pointer);
    unsafe {
        LocalFree(pointer as *mut c_void);
    }
    Ok(result)
}

pub fn copy_sid(pointer: PSID) -> AppResult<Vec<u8>> {
    let length = unsafe { GetLengthSid(pointer) };
    if length == 0 {
        return Err(last_error(
            "sid_copy_failed",
            "Could not read security identifier.",
        ));
    }
    let mut bytes = vec![0u8; length as usize];
    if unsafe { CopySid(length, bytes.as_mut_ptr() as PSID, pointer) } == 0 {
        return Err(last_error(
            "sid_copy_failed",
            "Could not copy security identifier.",
        ));
    }
    Ok(bytes)
}

pub fn random_hex(byte_count: usize) -> AppResult<String> {
    let mut bytes = vec![0u8; byte_count];
    let status = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            bytes.as_mut_ptr(),
            bytes.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if status < 0 {
        return Err(AppError::windows(
            "random_generation_failed",
            format!("Could not generate secure random value: {status}."),
        ));
    }
    let mut output = String::with_capacity(byte_count * 2);
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use windows_sys::Win32::Security::{TOKEN_DUPLICATE, TOKEN_QUERY};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    use super::{OwnedHandle, quote_argument, sid_from_string, token_has_enabled_sid};

    #[test]
    fn quotes_windows_arguments_without_losing_backslashes() {
        assert_eq!(quote_argument("plain"), "plain");
        assert_eq!(quote_argument("two words"), "\"two words\"");
        assert_eq!(quote_argument("a\\\"b"), "\"a\\\\\\\"b\"");
        assert_eq!(
            quote_argument("C:\\path with space\\"),
            "\"C:\\path with space\\\\\""
        );
    }

    #[test]
    fn checks_membership_for_primary_process_token() {
        let mut token = std::ptr::null_mut();
        assert_ne!(
            unsafe {
                OpenProcessToken(
                    GetCurrentProcess(),
                    TOKEN_QUERY | TOKEN_DUPLICATE,
                    &mut token,
                )
            },
            0
        );
        let token = OwnedHandle::new(token, "test_failed", "test failed").unwrap();
        let everyone = sid_from_string("S-1-1-0").unwrap();

        assert!(token_has_enabled_sid(&token, &everyone, "test_failed", "test failed").unwrap());
    }
}
