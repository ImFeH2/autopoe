use futures_util::StreamExt;

use crate::{
    AgentError, ConversationItem, Message, MessageRole, Provider, ProviderEvent, ProviderRequest,
    RunEvent, Tool, ToolCall, ToolDefinition, ToolResult,
};

const DEFAULT_MAX_TURNS: usize = 8;

struct RegisteredTool {
    definition: ToolDefinition,
    handler: Box<dyn Tool>,
}

pub struct Agent<P> {
    provider: P,
    tools: Vec<RegisteredTool>,
    max_turns: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOutput {
    pub content: String,
    pub turns: usize,
}

impl<P> Agent<P> {
    pub fn new(provider: P) -> Self {
        Self {
            provider,
            tools: Vec::new(),
            max_turns: DEFAULT_MAX_TURNS,
        }
    }

    pub fn with_tool<T>(mut self, tool: T) -> Self
    where
        T: Tool + 'static,
    {
        let definition = tool.definition();
        self.tools
            .retain(|registered| registered.definition.name != definition.name);
        self.tools.push(RegisteredTool {
            definition,
            handler: Box::new(tool),
        });
        self
    }

    pub fn with_max_turns(mut self, max_turns: usize) -> Self {
        self.max_turns = max_turns.max(1);
        self
    }
}

impl<P> Agent<P>
where
    P: Provider,
{
    pub async fn run<E>(&self, messages: Vec<Message>, mut emit: E) -> Result<RunOutput, AgentError>
    where
        E: FnMut(RunEvent) -> Result<(), String>,
    {
        Self::emit(&mut emit, RunEvent::Started)?;

        let result = self.run_loop(messages, &mut emit).await;

        match result {
            Ok(output) => {
                Self::emit(&mut emit, RunEvent::Completed)?;
                Ok(output)
            }
            Err(error) => {
                Self::emit(
                    &mut emit,
                    RunEvent::Failed {
                        message: error.to_string(),
                    },
                )?;
                Err(error)
            }
        }
    }

    async fn run_loop<E>(
        &self,
        messages: Vec<Message>,
        emit: &mut E,
    ) -> Result<RunOutput, AgentError>
    where
        E: FnMut(RunEvent) -> Result<(), String>,
    {
        if !messages
            .iter()
            .any(|message| message.role == MessageRole::User && !message.content.trim().is_empty())
        {
            return Err(AgentError::EmptyConversation);
        }

        let mut items = messages
            .into_iter()
            .map(ConversationItem::Message)
            .collect::<Vec<_>>();
        let definitions = self
            .tools
            .iter()
            .map(|registered| registered.definition.clone())
            .collect::<Vec<_>>();
        let mut content = String::new();

        for turn in 1..=self.max_turns {
            let (turn_content, tool_calls) = {
                let request = ProviderRequest {
                    items: &items,
                    tools: &definitions,
                };
                let mut stream = self.provider.stream(request);
                let mut turn_content = String::new();
                let mut tool_calls = Vec::new();

                while let Some(event) = stream.next().await {
                    match event.map_err(AgentError::Provider)? {
                        ProviderEvent::TextDelta { delta } if !delta.is_empty() => {
                            turn_content.push_str(&delta);
                            content.push_str(&delta);
                            Self::emit(emit, RunEvent::TextDelta { delta })?;
                        }
                        ProviderEvent::TextDelta { .. } => {}
                        ProviderEvent::ToolCall(tool_call) => tool_calls.push(tool_call),
                    }
                }

                (turn_content, tool_calls)
            };

            if !turn_content.is_empty() {
                items.push(ConversationItem::Message(Message::assistant(turn_content)));
            }

            if tool_calls.is_empty() {
                return Ok(RunOutput {
                    content,
                    turns: turn,
                });
            }

            for tool_call in tool_calls {
                self.execute_tool(&mut items, tool_call).await?;
            }
        }

        Err(AgentError::MaxTurnsExceeded(self.max_turns))
    }

    async fn execute_tool(
        &self,
        items: &mut Vec<ConversationItem>,
        tool_call: ToolCall,
    ) -> Result<(), AgentError> {
        let registered = self
            .tools
            .iter()
            .find(|registered| registered.definition.name == tool_call.name)
            .ok_or_else(|| AgentError::ToolNotFound(tool_call.name.clone()))?;
        let name = tool_call.name.clone();
        let call_id = tool_call.id.clone();
        let arguments = tool_call.arguments.clone();

        items.push(ConversationItem::ToolCall(tool_call));

        let output = registered
            .handler
            .call(arguments)
            .await
            .map_err(|message| AgentError::Tool { name, message })?;

        items.push(ConversationItem::ToolResult(ToolResult { call_id, output }));

        Ok(())
    }

    fn emit<E>(emit: &mut E, event: RunEvent) -> Result<(), AgentError>
    where
        E: FnMut(RunEvent) -> Result<(), String>,
    {
        emit(event).map_err(AgentError::EventSink)
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::VecDeque,
        sync::{Arc, Mutex},
    };

    use futures_executor::block_on;
    use futures_util::{StreamExt, stream};
    use serde_json::{Value, json};

    use super::Agent;
    use crate::{
        AgentError, ConversationItem, Message, Provider, ProviderEvent, ProviderRequest,
        ProviderStream, RunEvent, RunOutput, Tool, ToolCall, ToolDefinition, ToolFuture,
        ToolResult,
    };

    #[derive(Clone)]
    struct ScriptedProvider {
        turns: Arc<Mutex<VecDeque<Vec<ProviderEvent>>>>,
        requests: Arc<Mutex<Vec<Vec<ConversationItem>>>>,
    }

    impl ScriptedProvider {
        fn new(turns: Vec<Vec<ProviderEvent>>) -> Self {
            Self {
                turns: Arc::new(Mutex::new(turns.into())),
                requests: Arc::default(),
            }
        }

        fn requests(&self) -> Vec<Vec<ConversationItem>> {
            self.requests.lock().expect("requests lock").clone()
        }
    }

    impl Provider for ScriptedProvider {
        fn stream<'a>(&'a self, request: ProviderRequest<'a>) -> ProviderStream<'a> {
            self.requests
                .lock()
                .expect("requests lock")
                .push(request.items.to_vec());
            let events = self
                .turns
                .lock()
                .expect("turns lock")
                .pop_front()
                .unwrap_or_default();

            stream::iter(events.into_iter().map(Ok::<_, String>)).boxed()
        }
    }

    struct EchoTool;

    impl Tool for EchoTool {
        fn definition(&self) -> ToolDefinition {
            ToolDefinition {
                name: "echo".to_owned(),
                description: "Returns its input".to_owned(),
                input_schema: json!({ "type": "object" }),
            }
        }

        fn call(&self, arguments: Value) -> ToolFuture<'_> {
            Box::pin(async move { Ok(arguments) })
        }
    }

    #[test]
    fn streams_text_and_completes() {
        let provider = ScriptedProvider::new(vec![vec![
            ProviderEvent::TextDelta {
                delta: "Hel".to_owned(),
            },
            ProviderEvent::TextDelta {
                delta: "lo".to_owned(),
            },
        ]]);
        let agent = Agent::new(provider);
        let mut events = Vec::new();

        let output = block_on(agent.run(vec![Message::user("Hi")], |event| {
            events.push(event);
            Ok(())
        }))
        .expect("run succeeds");

        assert_eq!(
            output,
            RunOutput {
                content: "Hello".to_owned(),
                turns: 1,
            }
        );
        assert_eq!(
            events,
            vec![
                RunEvent::Started,
                RunEvent::TextDelta {
                    delta: "Hel".to_owned(),
                },
                RunEvent::TextDelta {
                    delta: "lo".to_owned(),
                },
                RunEvent::Completed,
            ]
        );
    }

    #[test]
    fn executes_a_tool_before_continuing() {
        let tool_call = ToolCall {
            id: "call-1".to_owned(),
            name: "echo".to_owned(),
            arguments: json!({ "text": "Hello" }),
        };
        let provider = ScriptedProvider::new(vec![
            vec![ProviderEvent::ToolCall(tool_call.clone())],
            vec![ProviderEvent::TextDelta {
                delta: "Done".to_owned(),
            }],
        ]);
        let agent = Agent::new(provider.clone()).with_tool(EchoTool);
        let mut events = Vec::new();

        let output = block_on(agent.run(vec![Message::user("Echo this")], |event| {
            events.push(event);
            Ok(())
        }))
        .expect("run succeeds");

        assert_eq!(output.turns, 2);
        assert_eq!(output.content, "Done");
        assert_eq!(
            events,
            vec![
                RunEvent::Started,
                RunEvent::TextDelta {
                    delta: "Done".to_owned(),
                },
                RunEvent::Completed,
            ]
        );

        let requests = provider.requests();
        assert_eq!(requests.len(), 2);
        assert_eq!(
            requests[1],
            vec![
                ConversationItem::Message(Message::user("Echo this")),
                ConversationItem::ToolCall(tool_call),
                ConversationItem::ToolResult(ToolResult {
                    call_id: "call-1".to_owned(),
                    output: json!({ "text": "Hello" }),
                }),
            ]
        );
    }

    #[test]
    fn fails_when_a_tool_is_missing() {
        let provider = ScriptedProvider::new(vec![vec![ProviderEvent::ToolCall(ToolCall {
            id: "call-1".to_owned(),
            name: "missing".to_owned(),
            arguments: json!({}),
        })]]);
        let agent = Agent::new(provider);
        let mut events = Vec::new();

        let error = block_on(agent.run(vec![Message::user("Run a tool")], |event| {
            events.push(event);
            Ok(())
        }))
        .expect_err("run fails");

        assert_eq!(error, AgentError::ToolNotFound("missing".to_owned()));
        assert_eq!(
            events,
            vec![
                RunEvent::Started,
                RunEvent::Failed {
                    message: "tool not found: missing".to_owned(),
                },
            ]
        );
    }
}
