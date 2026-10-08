/**
 * AG-UI protocol types (subset used by sonic-chat).
 * Source of truth: https://docs.ag-ui.com/ (event `type` values are SCREAMING_SNAKE_CASE on the wire).
 */

export type AgUiRole = "developer" | "system" | "assistant" | "user" | "tool" | "activity" | "reasoning";

export type AgUiMessage =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content?: string }
  | { id: string; role: "system" | "developer"; content: string }
  | { id: string; role: "tool"; content: string; toolCallId: string };

export type RunAgentInput = {
  threadId: string;
  runId: string;
  messages: AgUiMessage[];
  state?: unknown;
  tools?: unknown[];
  context?: { description: string; value: string }[];
  forwardedProps?: Record<string, unknown>;
};

type Base = { timestamp?: number; rawEvent?: unknown };

export type AgUiEvent = Base &
  (
    | { type: "RUN_STARTED"; threadId: string; runId: string }
    | { type: "RUN_FINISHED"; threadId?: string; runId?: string; result?: unknown }
    | { type: "RUN_ERROR"; message: string; code?: string }
    | { type: "STEP_STARTED" | "STEP_FINISHED"; stepName: string }
    | { type: "TEXT_MESSAGE_START"; messageId: string; role?: AgUiRole }
    | { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string }
    | { type: "TEXT_MESSAGE_END"; messageId: string }
    | { type: "TEXT_MESSAGE_CHUNK"; messageId?: string; role?: AgUiRole; delta?: string }
    | { type: "TOOL_CALL_START"; toolCallId: string; toolCallName: string; parentMessageId?: string }
    | { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string }
    | { type: "TOOL_CALL_END"; toolCallId: string }
    | { type: "TOOL_CALL_RESULT"; messageId: string; toolCallId: string; content: string }
    | { type: "ACTIVITY_SNAPSHOT"; messageId: string; activityType: string; content: unknown; replace?: boolean }
    | { type: "CUSTOM"; name: string; value: unknown }
    | { type: string; [key: string]: unknown }
  );
