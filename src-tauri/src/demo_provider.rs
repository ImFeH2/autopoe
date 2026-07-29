use std::time::Duration;

use agent::{
    ConversationItem, MessageRole, Provider, ProviderEvent, ProviderRequest, ProviderStream,
};
use futures_util::stream;
use tokio::time::sleep;

pub struct DemoProvider;

impl Provider for DemoProvider {
    fn stream<'a>(&'a self, request: ProviderRequest<'a>) -> ProviderStream<'a> {
        let user_messages = request
            .items
            .iter()
            .filter_map(|item| match item {
                ConversationItem::Message(message) if message.role == MessageRole::User => {
                    Some(message.content.as_str())
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        let latest_message = user_messages.last().copied().unwrap_or_default();
        let preview = latest_message.chars().take(96).collect::<String>();
        let suffix = if latest_message.chars().count() > 96 {
            "…"
        } else {
            ""
        };
        let response = if user_messages.len() > 1 {
            format!(
                "I received “{preview}{suffix}” as turn {}. The full conversation reached the Rust runtime, and each response chunk is streaming back through Tauri.",
                user_messages.len()
            )
        } else {
            format!(
                "I received “{preview}{suffix}”. This is Flowent’s local demo provider, streaming through the Rust Agent loop and Tauri Channel. Connect a model provider next to generate real responses."
            )
        };
        let chunks = response
            .split_inclusive(' ')
            .map(str::to_owned)
            .collect::<Vec<_>>()
            .into_iter();

        Box::pin(stream::unfold(chunks, |mut chunks| async move {
            let delta = chunks.next()?;
            sleep(Duration::from_millis(24)).await;
            Some((Ok(ProviderEvent::TextDelta { delta }), chunks))
        }))
    }
}
