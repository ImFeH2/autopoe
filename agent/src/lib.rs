use serde::Serialize;

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
