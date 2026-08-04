use anyhow::{Context, Result, bail};
use keyring::{Entry, Error};

const SERVICE: &str = "im.feh2.flowent";

pub fn set(key: &str, value: &str) -> Result<()> {
    if value.is_empty() {
        bail!("secret value is required");
    }
    entry(key)?
        .set_password(value)
        .context("store secret in system credential store")
}

pub fn get(key: &str) -> Result<Option<String>> {
    match entry(key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(error) => Err(error).context("read secret from system credential store"),
    }
}

pub fn delete(key: &str) -> Result<()> {
    match entry(key)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(error) => Err(error).context("delete secret from system credential store"),
    }
}

fn entry(key: &str) -> Result<Entry> {
    if key.is_empty() {
        bail!("secret key is required");
    }
    Entry::new(SERVICE, key).context("open system credential store")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_keys() {
        match entry("") {
            Ok(_) => panic!("empty key was accepted"),
            Err(error) => assert_eq!(error.to_string(), "secret key is required"),
        }
    }
}
