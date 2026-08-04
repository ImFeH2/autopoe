use anyhow::{Context, Result, bail};
use keyring::{Entry, Error};

const SERVICE: &str = "im.feh2.flowent";

pub fn set_provider(provider_id: &str, value: &str) -> Result<()> {
    if value.is_empty() {
        bail!("secret value is required");
    }
    entry(&provider_key(provider_id)?)?
        .set_password(value)
        .context("store secret in system credential store")
}

pub fn get_provider(provider_id: &str) -> Result<Option<String>> {
    match entry(&provider_key(provider_id)?)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(error) => Err(error).context("read secret from system credential store"),
    }
}

pub fn delete_provider(provider_id: &str) -> Result<()> {
    match entry(&provider_key(provider_id)?)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(error) => Err(error).context("delete secret from system credential store"),
    }
}

fn provider_key(provider_id: &str) -> Result<String> {
    if provider_id.is_empty() {
        bail!("provider ID is required");
    }
    Ok(format!("provider/{provider_id}"))
}

fn entry(key: &str) -> Result<Entry> {
    Entry::new(SERVICE, key).context("open system credential store")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_provider_ids() {
        assert_eq!(
            provider_key("")
                .expect_err("empty provider ID was accepted")
                .to_string(),
            "provider ID is required"
        );
    }
}
