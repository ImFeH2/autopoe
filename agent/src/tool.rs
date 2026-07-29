use futures_util::future::BoxFuture;
use serde_json::Value;

use crate::ToolDefinition;

pub type ToolFuture<'a> = BoxFuture<'a, Result<Value, String>>;

pub trait Tool: Send + Sync {
    fn definition(&self) -> ToolDefinition;
    fn call(&self, arguments: Value) -> ToolFuture<'_>;
}
