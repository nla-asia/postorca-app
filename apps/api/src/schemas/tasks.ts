export type StoredMessage = {
  id: string;
  turn_id: string;
  kind: "user" | "assistant" | "tool_call" | "tool_result";
  content: any;
  created_at: string;
};
