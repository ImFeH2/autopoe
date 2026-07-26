use serde::{Deserialize, Serialize};
use std::ffi::c_void;
use std::fs;
use std::mem::size_of;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use windows_sys::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, GetLastError, LocalFree, S_OK};
use windows_sys::Win32::NetworkManagement::NetManagement::{
    LOCALGROUP_INFO_1, LOCALGROUP_MEMBERS_INFO_3, NERR_GroupExists, NERR_Success, NERR_UserExists,
    NetLocalGroupAdd, NetLocalGroupAddMembers, NetUserAdd, NetUserSetInfo, UF_DONT_EXPIRE_PASSWD,
    UF_PASSWD_CANT_CHANGE, UF_SCRIPT, USER_INFO_1, USER_INFO_1003, USER_PRIV_USER,
};
use windows_sys::Win32::Security::Cryptography::{
    BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom, CRYPT_INTEGER_BLOB,
    CRYPTPROTECT_LOCAL_MACHINE, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
};
use windows_sys::Win32::Security::{
    GetTokenInformation, LOGON32_LOGON_INTERACTIVE, LOGON32_PROVIDER_DEFAULT, LogonUserW,
    LookupAccountSidW, PSID, SID_NAME_USE, TOKEN_ELEVATION, TOKEN_QUERY, TOKEN_USER,
    TokenElevation, TokenUser,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows_sys::Win32::UI::Shell::CreateProfile;

use crate::error::{AppError, AppResult};
use crate::protocol::SETUP_VERSION;

use super::acl::{lookup_sid, protect_state_directory};
use super::firewall;
use super::util::{
    OwnedHandle, copy_sid, sid_from_string, sid_to_string, token_has_enabled_sid, wide,
};

pub const SANDBOX_GROUP: &str = "FlowentSandboxUsers";
pub const ONLINE_USER: &str = "FlowentSandboxOnline";
pub const OFFLINE_USER: &str = "FlowentSandboxNoNet";

const _: () = assert!(ONLINE_USER.len() <= 20);
const _: () = assert!(OFFLINE_USER.len() <= 20);

const MARKER_FILE: &str = "setup.json";
const SECRETS_FILE: &str = "credentials.json";
const PROFILE_ALREADY_EXISTS: i32 = 0x800700B7_u32 as i32;
const PROFILE_PATH_CAPACITY: usize = 32768;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetupMarker {
    pub version: u32,
    pub group_sid: String,
    pub online_sid: String,
    pub offline_sid: String,
    pub owner_sid: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountSecret {
    username: String,
    protected_password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SetupSecrets {
    version: u32,
    online: AccountSecret,
    offline: AccountSecret,
}

#[derive(Debug, Clone)]
pub struct AccountCredentials {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone)]
pub struct InstalledSetup {
    pub marker: SetupMarker,
    pub online: AccountCredentials,
    pub offline: AccountCredentials,
}

pub fn install(state_dir: &Path, owner_sid: Option<&str>) -> AppResult<InstalledSetup> {
    require_elevated()?;
    require_absolute_directory_path(state_dir)?;
    fs::create_dir_all(state_dir)
        .map_err(|error| AppError::io("Could not create protection settings directory", error))?;
    if fs::symlink_metadata(state_dir)
        .map_err(|error| AppError::io("Could not inspect protection settings directory", error))?
        .file_type()
        .is_symlink()
    {
        return Err(AppError::windows(
            "reparse_path_rejected",
            "Protection settings directory cannot be a symbolic link.",
        ));
    }
    ensure_group()?;
    let group_sid = lookup_sid(SANDBOX_GROUP)?;
    let owner_sid = owner_sid
        .map(str::to_string)
        .unwrap_or(current_user_sid_string()?);
    sid_from_string(&owner_sid)?;
    protect_state_directory(state_dir, &owner_sid, &group_sid)?;

    let online_password = random_password()?;
    let offline_password = random_password()?;
    ensure_user(ONLINE_USER, &online_password)?;
    ensure_user(OFFLINE_USER, &offline_password)?;
    ensure_membership(SANDBOX_GROUP, ONLINE_USER)?;
    ensure_membership(SANDBOX_GROUP, OFFLINE_USER)?;
    ensure_builtin_users_membership(ONLINE_USER)?;
    ensure_builtin_users_membership(OFFLINE_USER)?;
    let online_sid = sid_to_string(&lookup_sid(ONLINE_USER)?)?;
    let offline_sid = sid_to_string(&lookup_sid(OFFLINE_USER)?)?;
    ensure_profile(ONLINE_USER, &online_sid)?;
    ensure_profile(OFFLINE_USER, &offline_sid)?;
    verify_low_privilege_account(ONLINE_USER, &online_password, &group_sid)?;
    verify_low_privilege_account(OFFLINE_USER, &offline_password, &group_sid)?;

    firewall::ensure_offline_rule(&offline_sid)?;

    let marker = SetupMarker {
        version: SETUP_VERSION,
        group_sid: sid_to_string(&group_sid)?,
        online_sid,
        offline_sid,
        owner_sid,
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| AppError::windows("system_clock_failed", error.to_string()))?
            .as_secs(),
    };
    let secrets = SetupSecrets {
        version: SETUP_VERSION,
        online: AccountSecret {
            username: ONLINE_USER.to_string(),
            protected_password: hex_encode(&protect(online_password.as_bytes())?),
        },
        offline: AccountSecret {
            username: OFFLINE_USER.to_string(),
            protected_password: hex_encode(&protect(offline_password.as_bytes())?),
        },
    };
    write_json(&state_dir.join(SECRETS_FILE), &secrets)?;
    write_json(&state_dir.join(MARKER_FILE), &marker)?;
    load(state_dir)
}

pub fn load(state_dir: &Path) -> AppResult<InstalledSetup> {
    require_absolute_directory_path(state_dir)?;
    let marker_path = state_dir.join(MARKER_FILE);
    let secrets_path = state_dir.join(SECRETS_FILE);
    let marker: SetupMarker = read_json(&marker_path).map_err(|error| {
        if error.code == "io_error" {
            AppError::setup_required("Windows command protection has not been set up.")
        } else {
            error
        }
    })?;
    let secrets: SetupSecrets = read_json(&secrets_path).map_err(|error| {
        if error.code == "io_error" {
            AppError::setup_required("Windows command protection has not been set up.")
        } else {
            error
        }
    })?;
    if marker.version != SETUP_VERSION || secrets.version != SETUP_VERSION {
        return Err(AppError::setup_required(
            "Windows command protection setup must be refreshed.",
        ));
    }
    let current_group_sid = sid_to_string(&lookup_sid(SANDBOX_GROUP)?)?;
    let current_online_sid = sid_to_string(&lookup_sid(&secrets.online.username)?)?;
    let current_offline_sid = sid_to_string(&lookup_sid(&secrets.offline.username)?)?;
    if !current_group_sid.eq_ignore_ascii_case(&marker.group_sid)
        || !current_online_sid.eq_ignore_ascii_case(&marker.online_sid)
        || !current_offline_sid.eq_ignore_ascii_case(&marker.offline_sid)
    {
        return Err(AppError::setup_required(
            "Windows command protection accounts have changed and setup must be refreshed.",
        ));
    }
    let online = decode_credentials(secrets.online)?;
    let offline = decode_credentials(secrets.offline)?;
    verify_low_privilege_account(
        &online.username,
        &online.password,
        &lookup_sid(SANDBOX_GROUP)?,
    )?;
    verify_low_privilege_account(
        &offline.username,
        &offline.password,
        &lookup_sid(SANDBOX_GROUP)?,
    )?;
    firewall::verify_offline_rule(&marker.offline_sid)?;
    Ok(InstalledSetup {
        marker,
        online,
        offline,
    })
}

fn decode_credentials(secret: AccountSecret) -> AppResult<AccountCredentials> {
    let encrypted = hex_decode(&secret.protected_password)?;
    let password = String::from_utf8(unprotect(&encrypted)?)
        .map_err(|error| AppError::windows("credential_decode_failed", error.to_string()))?;
    Ok(AccountCredentials {
        username: secret.username,
        password,
    })
}

fn ensure_group() -> AppResult<()> {
    let mut name = wide(SANDBOX_GROUP);
    let mut comment = wide("Flowent protected command accounts");
    let info = LOCALGROUP_INFO_1 {
        lgrpi1_name: name.as_mut_ptr(),
        lgrpi1_comment: comment.as_mut_ptr(),
    };
    let mut parameter_error = 0u32;
    let status = unsafe {
        NetLocalGroupAdd(
            std::ptr::null(),
            1,
            &info as *const _ as *const u8,
            &mut parameter_error,
        )
    };
    if status != NERR_Success && status != NERR_GroupExists && status != 1379 {
        return Err(AppError::windows(
            "group_setup_failed",
            format!("Could not create protected account group: {status}."),
        ));
    }
    Ok(())
}

fn ensure_user(username: &str, password: &str) -> AppResult<()> {
    let mut name = wide(username);
    let mut password_wide = wide(password);
    let mut comment = wide("Flowent protected command account");
    let info = USER_INFO_1 {
        usri1_name: name.as_mut_ptr(),
        usri1_password: password_wide.as_mut_ptr(),
        usri1_password_age: 0,
        usri1_priv: USER_PRIV_USER,
        usri1_home_dir: std::ptr::null_mut(),
        usri1_comment: comment.as_mut_ptr(),
        usri1_flags: UF_SCRIPT | UF_DONT_EXPIRE_PASSWD | UF_PASSWD_CANT_CHANGE,
        usri1_script_path: std::ptr::null_mut(),
    };
    let mut parameter_error = 0u32;
    let status = unsafe {
        NetUserAdd(
            std::ptr::null(),
            1,
            &info as *const _ as *const u8,
            &mut parameter_error,
        )
    };
    if status == NERR_UserExists {
        let password_info = USER_INFO_1003 {
            usri1003_password: password_wide.as_mut_ptr(),
        };
        let update_status = unsafe {
            NetUserSetInfo(
                std::ptr::null(),
                name.as_ptr(),
                1003,
                &password_info as *const _ as *const u8,
                &mut parameter_error,
            )
        };
        if update_status != NERR_Success {
            return Err(AppError::windows(
                "account_setup_failed",
                format!("Could not update protected account {username}: {update_status}."),
            ));
        }
    } else if status != NERR_Success {
        return Err(AppError::windows(
            "account_setup_failed",
            format!("Could not create protected account {username}: {status}."),
        ));
    }
    Ok(())
}

fn ensure_profile(username: &str, sid: &str) -> AppResult<()> {
    let username = wide(username);
    let sid = wide(sid);
    let mut profile_path = vec![0u16; PROFILE_PATH_CAPACITY];
    let result = unsafe {
        CreateProfile(
            sid.as_ptr(),
            username.as_ptr(),
            profile_path.as_mut_ptr(),
            profile_path.len() as u32,
        )
    };
    if profile_result_is_ready(result) {
        return Ok(());
    }
    Err(AppError::windows(
        "profile_setup_failed",
        "Windows could not finish command protection setup.",
    ))
}

fn profile_result_is_ready(result: i32) -> bool {
    result == S_OK || result == PROFILE_ALREADY_EXISTS
}

fn ensure_membership(group: &str, username: &str) -> AppResult<()> {
    let group_wide = wide(group);
    let mut username_wide = wide(username);
    let member = LOCALGROUP_MEMBERS_INFO_3 {
        lgrmi3_domainandname: username_wide.as_mut_ptr(),
    };
    let status = unsafe {
        NetLocalGroupAddMembers(
            std::ptr::null(),
            group_wide.as_ptr(),
            3,
            &member as *const _ as *const u8,
            1,
        )
    };
    if status != NERR_Success && status != 1378 {
        return Err(AppError::windows(
            "account_group_failed",
            format!("Could not add {username} to protected account group: {status}."),
        ));
    }
    Ok(())
}

fn ensure_builtin_users_membership(username: &str) -> AppResult<()> {
    let users_sid = sid_from_string("S-1-5-32-545")?;
    let group = account_name_for_sid(&users_sid)?;
    ensure_membership(&group, username)
}

fn account_name_for_sid(sid: &[u8]) -> AppResult<String> {
    let mut name_length = 0u32;
    let mut domain_length = 0u32;
    let mut sid_type: SID_NAME_USE = 0;
    unsafe {
        LookupAccountSidW(
            std::ptr::null(),
            sid.as_ptr() as PSID,
            std::ptr::null_mut(),
            &mut name_length,
            std::ptr::null_mut(),
            &mut domain_length,
            &mut sid_type,
        );
    }
    if unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER {
        return Err(super::util::last_error(
            "account_lookup_failed",
            "Could not resolve built-in account group.",
        ));
    }
    let mut name = vec![0u16; name_length as usize];
    let mut domain = vec![0u16; domain_length as usize];
    if unsafe {
        LookupAccountSidW(
            std::ptr::null(),
            sid.as_ptr() as PSID,
            name.as_mut_ptr(),
            &mut name_length,
            domain.as_mut_ptr(),
            &mut domain_length,
            &mut sid_type,
        )
    } == 0
    {
        return Err(super::util::last_error(
            "account_lookup_failed",
            "Could not resolve built-in account group.",
        ));
    }
    name.truncate(name_length as usize);
    Ok(String::from_utf16_lossy(&name)
        .trim_end_matches('\0')
        .to_string())
}

fn verify_low_privilege_account(username: &str, password: &str, group_sid: &[u8]) -> AppResult<()> {
    let username_wide = wide(username);
    let password_wide = wide(password);
    let domain = wide(".");
    let mut token = std::ptr::null_mut();
    if unsafe {
        LogonUserW(
            username_wide.as_ptr(),
            domain.as_ptr(),
            password_wide.as_ptr(),
            LOGON32_LOGON_INTERACTIVE,
            LOGON32_PROVIDER_DEFAULT,
            &mut token,
        )
    } == 0
    {
        return Err(super::util::last_error(
            "account_logon_failed",
            "Could not sign in to protected command account.",
        ));
    }
    let token = OwnedHandle::new(
        token,
        "account_logon_failed",
        "Could not open account token.",
    )?;
    let administrators = sid_from_string("S-1-5-32-544")?;
    let is_administrator = token_has_enabled_sid(
        &token,
        &administrators,
        "account_verification_failed",
        "Could not verify protected account privileges.",
    )?;
    let is_group_member = token_has_enabled_sid(
        &token,
        group_sid,
        "account_verification_failed",
        "Could not verify protected account membership.",
    )?;
    if is_administrator || !is_group_member {
        return Err(AppError::windows(
            "account_verification_failed",
            "Protected command account has unsafe group membership.",
        ));
    }
    Ok(())
}

fn require_elevated() -> AppResult<()> {
    let token = current_process_token(TOKEN_QUERY)?;
    let mut elevation = TOKEN_ELEVATION::default();
    let mut returned = 0u32;
    if unsafe {
        GetTokenInformation(
            token.get(),
            TokenElevation,
            &mut elevation as *mut _ as *mut c_void,
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        )
    } == 0
    {
        return Err(super::util::last_error(
            "elevation_check_failed",
            "Could not verify setup authorization.",
        ));
    }
    if elevation.TokenIsElevated == 0 {
        return Err(AppError::windows(
            "administrator_required",
            "Windows command protection setup requires administrator approval.",
        ));
    }
    Ok(())
}

fn current_user_sid_string() -> AppResult<String> {
    let token = current_process_token(TOKEN_QUERY)?;
    let mut length = 0u32;
    unsafe {
        GetTokenInformation(token.get(), TokenUser, std::ptr::null_mut(), 0, &mut length);
    }
    if unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER {
        return Err(super::util::last_error(
            "owner_lookup_failed",
            "Could not size current account information.",
        ));
    }
    let mut buffer = vec![0u8; length as usize];
    if unsafe {
        GetTokenInformation(
            token.get(),
            TokenUser,
            buffer.as_mut_ptr() as *mut c_void,
            length,
            &mut length,
        )
    } == 0
    {
        return Err(super::util::last_error(
            "owner_lookup_failed",
            "Could not read current account information.",
        ));
    }
    let token_user = unsafe { &*(buffer.as_ptr() as *const TOKEN_USER) };
    sid_to_string(&copy_sid(token_user.User.Sid)?)
}

fn current_process_token(access: u32) -> AppResult<OwnedHandle> {
    let mut token = std::ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), access, &mut token) } == 0 {
        return Err(super::util::last_error(
            "token_open_failed",
            "Could not open process identity.",
        ));
    }
    OwnedHandle::new(
        token,
        "token_open_failed",
        "Could not open process identity.",
    )
}

fn random_password() -> AppResult<String> {
    let mut bytes = [0u8; 32];
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
            format!("Could not generate protected account credential: {status}."),
        ));
    }
    Ok(format!("Fx1!{}", hex_encode(&bytes)))
}

fn protect(value: &[u8]) -> AppResult<Vec<u8>> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: value.len() as u32,
        pbData: value.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    if unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_LOCAL_MACHINE | CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    } == 0
    {
        return Err(super::util::last_error(
            "credential_protection_failed",
            "Could not protect account credential.",
        ));
    }
    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        LocalFree(output.pbData as *mut c_void);
    }
    Ok(bytes)
}

fn unprotect(value: &[u8]) -> AppResult<Vec<u8>> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: value.len() as u32,
        pbData: value.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    if unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_LOCAL_MACHINE | CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    } == 0
    {
        return Err(super::util::last_error(
            "credential_unprotect_failed",
            "Could not unlock protected account credential.",
        ));
    }
    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        LocalFree(output.pbData as *mut c_void);
    }
    Ok(bytes)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let bytes = serde_json::to_vec(value)
        .map_err(|error| AppError::windows("settings_serialization_failed", error.to_string()))?;
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&temporary, bytes)
        .map_err(|error| AppError::io("Could not write protection settings", error))?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| AppError::io("Could not replace protection settings", error))?;
    }
    fs::rename(&temporary, path)
        .map_err(|error| AppError::io("Could not publish protection settings", error))
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> AppResult<T> {
    let bytes = fs::read(path)
        .map_err(|error| AppError::io("Could not read protection settings", error))?;
    serde_json::from_slice(&bytes).map_err(|error| {
        AppError::setup_required(format!("Protection settings are invalid: {error}"))
    })
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn hex_decode(value: &str) -> AppResult<Vec<u8>> {
    if value.len() % 2 != 0 {
        return Err(AppError::setup_required(
            "Protected account credential is invalid.",
        ));
    }
    (0..value.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&value[index..index + 2], 16)
                .map_err(|_| AppError::setup_required("Protected account credential is invalid."))
        })
        .collect()
}

fn require_absolute_directory_path(path: &Path) -> AppResult<()> {
    if !path.is_absolute() {
        return Err(AppError::invalid(
            "Protection settings directory must be an absolute path.",
        ));
    }
    Ok(())
}

pub fn marker_path(state_dir: &Path) -> PathBuf {
    state_dir.join(MARKER_FILE)
}

#[cfg(test)]
mod tests {
    use windows_sys::Win32::Foundation::S_OK;

    use super::{PROFILE_ALREADY_EXISTS, profile_result_is_ready};

    #[test]
    fn profile_creation_accepts_new_and_existing_profiles() {
        assert!(profile_result_is_ready(S_OK));
        assert!(profile_result_is_ready(PROFILE_ALREADY_EXISTS));
        assert!(!profile_result_is_ready(0x80070005_u32 as i32));
    }
}
