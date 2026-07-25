use windows::Win32::Foundation::VARIANT_TRUE;
use windows::Win32::NetworkManagement::WindowsFirewall::{
    INetFwPolicy2, INetFwRule3, NET_FW_ACTION_BLOCK, NET_FW_IP_PROTOCOL_ANY, NET_FW_PROFILE2_ALL,
    NET_FW_RULE_DIR_OUT, NetFwPolicy2, NetFwRule,
};
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
    CoUninitialize,
};
use windows::core::{BSTR, Interface};

use crate::error::{AppError, AppResult};

const RULE_NAME: &str = "flowent_protected_commands_offline";

struct ComGuard;

impl ComGuard {
    fn initialize() -> AppResult<Self> {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
            .ok()
            .map_err(|error| AppError::windows("firewall_unavailable", error.to_string()))?;
        Ok(Self)
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

pub fn ensure_offline_rule(sid: &str) -> AppResult<()> {
    let _guard = ComGuard::initialize()?;
    let policy: INetFwPolicy2 =
        unsafe { CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER) }
            .map_err(|error| AppError::windows("firewall_unavailable", error.to_string()))?;
    let rules = unsafe { policy.Rules() }
        .map_err(|error| AppError::windows("firewall_unavailable", error.to_string()))?;
    let name = BSTR::from(RULE_NAME);
    let rule: INetFwRule3 = match unsafe { rules.Item(&name) } {
        Ok(existing) => existing
            .cast()
            .map_err(|error| AppError::windows("firewall_rule_failed", error.to_string()))?,
        Err(_) => {
            let created: INetFwRule3 =
                unsafe { CoCreateInstance(&NetFwRule, None, CLSCTX_INPROC_SERVER) }.map_err(
                    |error| AppError::windows("firewall_rule_failed", error.to_string()),
                )?;
            unsafe { created.SetName(&name) }
                .map_err(|error| AppError::windows("firewall_rule_failed", error.to_string()))?;
            configure(&created, sid)?;
            unsafe { rules.Add(&created) }
                .map_err(|error| AppError::windows("firewall_rule_failed", error.to_string()))?;
            created
        }
    };
    configure(&rule, sid)?;
    verify_rule(&rule, sid)
}

pub fn verify_offline_rule(sid: &str) -> AppResult<()> {
    let _guard = ComGuard::initialize()?;
    let policy: INetFwPolicy2 =
        unsafe { CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER) }
            .map_err(|error| AppError::windows("firewall_unavailable", error.to_string()))?;
    let rules = unsafe { policy.Rules() }
        .map_err(|error| AppError::windows("firewall_unavailable", error.to_string()))?;
    let rule: INetFwRule3 = unsafe { rules.Item(&BSTR::from(RULE_NAME)) }
        .map_err(|_| {
            AppError::setup_required("Windows protection setup must refresh its network rule.")
        })?
        .cast()
        .map_err(|error| AppError::windows("firewall_rule_failed", error.to_string()))?;
    verify_rule(&rule, sid)
}

fn configure(rule: &INetFwRule3, sid: &str) -> AppResult<()> {
    let user_scope = BSTR::from(format!("O:LSD:(A;;CC;;;{sid})"));
    unsafe {
        rule.SetDescription(&BSTR::from(
            "Flowent protected commands without network access",
        ))
        .and_then(|_| rule.SetDirection(NET_FW_RULE_DIR_OUT))
        .and_then(|_| rule.SetAction(NET_FW_ACTION_BLOCK))
        .and_then(|_| rule.SetEnabled(VARIANT_TRUE))
        .and_then(|_| rule.SetProfiles(NET_FW_PROFILE2_ALL.0))
        .and_then(|_| rule.SetProtocol(NET_FW_IP_PROTOCOL_ANY.0))
        .and_then(|_| rule.SetLocalUserAuthorizedList(&user_scope))
    }
    .map_err(|error| AppError::windows("firewall_rule_failed", error.to_string()))
}

fn verify_rule(rule: &INetFwRule3, sid: &str) -> AppResult<()> {
    let scope = unsafe { rule.LocalUserAuthorizedList() }
        .map_err(|error| AppError::windows("firewall_rule_verify_failed", error.to_string()))?;
    let enabled = unsafe { rule.Enabled() }
        .map_err(|error| AppError::windows("firewall_rule_verify_failed", error.to_string()))?;
    let direction = unsafe { rule.Direction() }
        .map_err(|error| AppError::windows("firewall_rule_verify_failed", error.to_string()))?;
    let action = unsafe { rule.Action() }
        .map_err(|error| AppError::windows("firewall_rule_verify_failed", error.to_string()))?;
    if !scope.to_string().contains(sid)
        || enabled != VARIANT_TRUE
        || direction != NET_FW_RULE_DIR_OUT
        || action != NET_FW_ACTION_BLOCK
    {
        return Err(AppError::setup_required(
            "Windows protection setup must refresh its network rule.",
        ));
    }
    Ok(())
}
