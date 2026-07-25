use serde::Serialize;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip)]
    pub exit_code: i32,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, exit_code: i32) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            exit_code,
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_request", message, 64)
    }

    pub fn setup_required(message: impl Into<String>) -> Self {
        Self::new("setup_required", message, 78)
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::new("sandbox_unavailable", message, 69)
    }

    pub fn windows(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(code, message, 70)
    }

    pub fn io(context: &str, error: std::io::Error) -> Self {
        Self::new("io_error", format!("{context}: {error}"), 74)
    }

    pub fn as_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| {
            format!(
                "{{\"code\":\"serialization_failed\",\"message\":{:?}}}",
                self.message
            )
        })
    }
}

impl Display for AppError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;
