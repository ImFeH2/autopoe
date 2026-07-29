use futures_util::stream::BoxStream;

use crate::{ConversationItem, ToolCall, ToolDefinition};

#[derive(Debug, Clone, Copy)]
pub struct ProviderRequest<'a> {
    pub items: &'a [ConversationItem],
    pub tools: &'a [ToolDefinition],
}

#[derive(Debug, Clone, PartialEq)]
pub enum ProviderEvent {
    TextDelta { delta: String },
    ToolCall(ToolCall),
}

pub type ProviderStream<'a> = BoxStream<'a, Result<ProviderEvent, String>>;

pub trait Provider: Send + Sync {
    fn stream<'a>(&'a self, request: ProviderRequest<'a>) -> ProviderStream<'a>;
}
