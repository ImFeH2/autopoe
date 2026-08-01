use anyhow::Error;
use serde::{Serialize, Serializer};

#[derive(Debug)]
pub struct CommandError(Error);

impl From<Error> for CommandError {
    fn from(error: Error) -> Self {
        Self(error)
    }
}

impl Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&format!("{:#}", self.0))
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_error_chain() {
        let error = CommandError(Error::msg("cause").context("context"));

        assert_eq!(serde_json::to_value(error).unwrap(), "context: cause");
    }
}
