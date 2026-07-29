use std::{error::Error, fmt};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentError {
    EmptyConversation,
    Provider(String),
    ToolNotFound(String),
    Tool { name: String, message: String },
    MaxTurnsExceeded(usize),
    EventSink(String),
}

impl fmt::Display for AgentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyConversation => {
                formatter.write_str("conversation requires a non-empty user message")
            }
            Self::Provider(message) => write!(formatter, "provider failed: {message}"),
            Self::ToolNotFound(name) => write!(formatter, "tool not found: {name}"),
            Self::Tool { name, message } => write!(formatter, "tool {name} failed: {message}"),
            Self::MaxTurnsExceeded(max_turns) => {
                write!(formatter, "agent exceeded {max_turns} turns")
            }
            Self::EventSink(message) => write!(formatter, "event sink failed: {message}"),
        }
    }
}

impl Error for AgentError {}
