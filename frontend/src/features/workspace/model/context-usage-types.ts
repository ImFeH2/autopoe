export type ContextUsage = {
  cached_input_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
};

export type ContextUsageInfo = {
  last_token_usage: ContextUsage;
  model_context_window?: number | null;
  total_token_usage: ContextUsage;
};
