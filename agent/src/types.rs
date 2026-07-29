use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    pub role: MessageRole,
    pub content: String,
}

impl Message {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: MessageRole::User,
            content: content.into(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: MessageRole::Assistant,
            content: content.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    #[default]
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RunEvent {
    Started,
    TextDelta { delta: String },
    Completed,
    Failed { message: String },
    Cancelled,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolResult {
    pub call_id: String,
    pub output: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConversationItem {
    Message(Message),
    ToolCall(ToolCall),
    ToolResult(ToolResult),
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{RunEvent, RunState};

    #[test]
    fn run_state_defaults_to_pending() {
        assert_eq!(RunState::default(), RunState::Pending);
    }

    #[test]
    fn run_states_have_stable_json_shapes() -> serde_json::Result<()> {
        let cases = [
            (RunState::Pending, json!("pending")),
            (RunState::Running, json!("running")),
            (RunState::Completed, json!("completed")),
            (RunState::Failed, json!("failed")),
            (RunState::Cancelled, json!("cancelled")),
        ];

        for (state, expected) in cases {
            assert_eq!(serde_json::to_value(state)?, expected);
        }

        Ok(())
    }

    #[test]
    fn run_events_have_stable_json_shapes() -> serde_json::Result<()> {
        let cases = [
            (RunEvent::Started, json!({ "type": "started" })),
            (
                RunEvent::TextDelta {
                    delta: "Hello".to_owned(),
                },
                json!({ "type": "text_delta", "delta": "Hello" }),
            ),
            (RunEvent::Completed, json!({ "type": "completed" })),
            (
                RunEvent::Failed {
                    message: "Unavailable".to_owned(),
                },
                json!({ "type": "failed", "message": "Unavailable" }),
            ),
            (RunEvent::Cancelled, json!({ "type": "cancelled" })),
        ];

        for (event, expected) in cases {
            assert_eq!(serde_json::to_value(event)?, expected);
        }

        Ok(())
    }
}
