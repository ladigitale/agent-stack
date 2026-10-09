import "@supersoniks/concorde/sdui";
import "../libraries/components";
import type { SDUIDescriptor } from "@supersoniks/concorde/core/components/functional/sdui/types";
import { A2uiRenderer } from "../a2ui/renderer";
import type { A2uiClientError, A2uiClientMessage, A2uiServerMessage } from "../a2ui/types";
import { agentStackLibrary } from "../libraries";
import type { AgUiEvent, AgUiMessage, RunAgentInput } from "./ag-ui";
import type { AgentTransport } from "./transport";

/** Names under which UI payloads travel inside AG-UI. See docs/backend-contract.md. */
export const A2UI_CARRIER = "a2ui";
export const SDUI_CARRIER = "sdui";
/** `CUSTOM { name: "status", value: string | { label: string } }` : libellé d'état précis donné par le backend. */
export const STATUS_CARRIER = "status";

/** What the agent is doing right now, for a "working…" indicator. */
export type ChatStatus =
  | { phase: "sending" }
  | { phase: "thinking" }
  | { phase: "tool"; tool: Extract<ChatItem, { kind: "tool" }> }
  | { phase: "writing" }
  | { phase: "custom"; label: string };

export type ChatItem =
  | { kind: "text"; id: string; role: "user" | "assistant"; text: string; streaming: boolean }
  | { kind: "ui"; id: string; host: HTMLElement }
  | { kind: "tool"; id: string; name: string; done: boolean; args?: Record<string, unknown> }
  | { kind: "error"; id: string; message: string };

export type ChatSessionOptions = {
  transport: AgentTransport;
  threadId?: string;
  /** Extra AG-UI context sent with each run. */
  context?: RunAgentInput["context"];
  /** Extra `forwardedProps` merged into each run (read at run time). */
  forwardedProps?: () => Record<string, unknown>;
  onChange?: () => void;
  onWarning?: (message: string) => void;
  /** Where to inject the UI blocks' CSS (the shadow root hosting the chat, if any). */
  styleTarget?: Document | ShadowRoot;
  /** Any other `CUSTOM` event (app-specific payloads, e.g. a document preview). */
  onCustom?: (name: string, value: unknown) => void;
  /** `RUN_ERROR` (and transport failures), with the backend's `code` when it sends one. */
  onRunError?: (error: { message: string; code?: string }) => void;
};

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Conversation state driven by AG-UI events. Owns the DOM hosts of UI blocks
 * (A2UI surfaces and SDUI descriptors) but not the chat layout: `sonic-chat`
 * renders `items`, any other shell can too.
 *
 * UI payloads:
 * - `CUSTOM { name: "a2ui", value: A2UI message | message[] }`
 * - `ACTIVITY_SNAPSHOT { activityType: "a2ui", content: { messages: [...] } }`
 * - `CUSTOM { name: "sdui", value: SDUIDescriptor }` (libraries `a2ui-basic` + `chat` available)
 *
 * User actions start a new run with `forwardedProps.a2uiAction` (A2UI) or
 * `forwardedProps.sduiAction` (SDUI). A2UI client errors ride along with the
 * next run in `forwardedProps.a2uiErrors`: they never trigger a run themselves.
 */
export class ChatSession {
  readonly threadId: string;
  items: ChatItem[] = [];
  running = false;
  /** Start of the current run (ms epoch), for an elapsed-time display. */
  runStartedAt = 0;

  private serverStatus?: string;
  private gotEvent = false;
  private toolArgs = new Map<string, string>();
  private history: AgUiMessage[] = [];
  private renderer: A2uiRenderer;
  private pendingErrors: A2uiClientError[] = [];
  private abort?: AbortController;
  private textItems = new Map<string, Extract<ChatItem, { kind: "text" }>>();
  private toolItems = new Map<string, Extract<ChatItem, { kind: "tool" }>>();

  constructor(private readonly options: ChatSessionOptions) {
    this.threadId = options.threadId ?? uid();
    this.renderer = new A2uiRenderer({
      resolveContainer: () => this.addUiBlock(),
      onClientMessage: (msg) => this.onA2uiClientMessage(msg),
      onWarning: (w) => options.onWarning?.(w),
      styleTarget: options.styleTarget,
    });
  }

  /** Current state of the running agent, or null when idle. */
  get status(): ChatStatus | null {
    if (!this.running) return null;
    const tool = [...this.toolItems.values()].reverse().find((t) => !t.done);
    if (tool) return { phase: "tool", tool };
    if (this.serverStatus) return { phase: "custom", label: this.serverStatus };
    if ([...this.textItems.values()].some((t) => t.streaming)) return { phase: "writing" };
    return this.gotEvent ? { phase: "thinking" } : { phase: "sending" };
  }

  /** Sends a user message and runs the agent. */
  send(text: string): Promise<void> {
    const content = text.trim();
    if (!content) return Promise.resolve();
    const message: AgUiMessage = { id: uid(), role: "user", content };
    this.history.push(message);
    this.push({ kind: "text", id: message.id, role: "user", text: content, streaming: false });
    return this.run();
  }

  /** Runs the agent with an action coming from a UI block. */
  sendAction(forwarded: Record<string, unknown>): Promise<void> {
    return this.run(forwarded);
  }

  stop(): void {
    this.abort?.abort();
  }

  destroy(): void {
    this.stop();
    this.renderer.destroy();
  }

  /** Applies one AG-UI event (public so a custom transport loop can feed it). */
  apply(event: AgUiEvent): void {
    this.gotEvent = true;
    switch (event.type) {
      case "RUN_STARTED":
      case "STEP_STARTED":
        break; // the run is alive: the status moves from "sending" to "thinking"
      case "TEXT_MESSAGE_START":
        this.startText(String(event.messageId));
        break;
      case "TEXT_MESSAGE_CONTENT":
      case "TEXT_MESSAGE_CHUNK": {
        const id = String(event.messageId ?? this.lastTextId() ?? uid());
        const item = this.textItems.get(id) ?? this.startText(id);
        item.text += String(event.delta ?? "");
        break;
      }
      case "TEXT_MESSAGE_END": {
        const item = this.textItems.get(String(event.messageId));
        if (item) this.commitText(item);
        break;
      }
      case "TOOL_CALL_START": {
        this.serverStatus = undefined;
        const item = { kind: "tool" as const, id: String(event.toolCallId), name: String(event.toolCallName), done: false };
        this.toolItems.set(item.id, item);
        this.push(item);
        break;
      }
      case "TOOL_CALL_ARGS": {
        const id = String(event.toolCallId);
        const raw = (this.toolArgs.get(id) ?? "") + String(event.delta ?? "");
        this.toolArgs.set(id, raw);
        const item = this.toolItems.get(id);
        if (item) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") item.args = parsed as Record<string, unknown>;
          } catch {
            /* arguments still streaming */
          }
        }
        break;
      }
      case "TOOL_CALL_END": {
        const item = this.toolItems.get(String(event.toolCallId));
        if (item) item.done = true;
        break;
      }
      case "CUSTOM":
        if (event.name === STATUS_CARRIER) {
          const v = event.value as string | { label?: unknown } | undefined;
          const label = typeof v === "string" ? v : typeof v?.label === "string" ? v.label : "";
          this.serverStatus = label || undefined;
        } else if (event.name === A2UI_CARRIER) this.handleA2ui(event.value);
        else if (event.name === SDUI_CARRIER) this.handleSdui(event.value as SDUIDescriptor);
        else {
          this.options.onCustom?.(String(event.name), event.value);
          return; // not a chat item: no change notification
        }
        break;
      case "ACTIVITY_SNAPSHOT":
        if (event.activityType === A2UI_CARRIER) {
          this.handleA2ui((event.content as { messages?: unknown })?.messages);
        }
        break;
      case "RUN_ERROR":
        this.push({ kind: "error", id: uid(), message: String(event.message) });
        this.options.onRunError?.({
          message: String(event.message),
          ...(typeof event.code === "string" ? { code: event.code } : {}),
        });
        break;
      default:
        return; // ignored event: no change notification
    }
    this.changed();
  }

  private async run(forwarded?: Record<string, unknown>): Promise<void> {
    if (this.running) {
      this.options.onWarning?.("A run is already in progress; request ignored");
      return;
    }
    this.running = true;
    this.gotEvent = false;
    this.serverStatus = undefined;
    this.runStartedAt = Date.now();
    this.abort = new AbortController();
    const forwardedProps: Record<string, unknown> = {
      ...this.options.forwardedProps?.(),
      ...forwarded,
      a2uiClientCapabilities: this.renderer.clientCapabilities,
    };
    if (this.pendingErrors.length) forwardedProps.a2uiErrors = this.pendingErrors.splice(0);
    const input: RunAgentInput = {
      threadId: this.threadId,
      runId: uid(),
      messages: [...this.history],
      context: this.options.context,
      forwardedProps,
    };
    this.changed();
    try {
      for await (const event of this.options.transport.run(input, this.abort.signal)) this.apply(event);
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        const message = String((e as Error)?.message ?? e);
        this.push({ kind: "error", id: uid(), message });
        this.options.onRunError?.({ message });
      }
    } finally {
      for (const item of this.textItems.values()) if (item.streaming) this.commitText(item);
      this.running = false;
      this.abort = undefined;
      this.changed();
    }
  }

  private handleA2ui(value: unknown) {
    const messages = Array.isArray(value) ? value : [value];
    for (const m of messages) {
      if (m && typeof m === "object") this.renderer.handle(m as A2uiServerMessage);
    }
  }

  private handleSdui(descriptor: SDUIDescriptor) {
    if (!descriptor || typeof descriptor !== "object") return;
    const host = this.addUiBlock();
    const el = document.createElement("sonic-sdui") as HTMLElement & { props: unknown };
    el.setAttribute("profile", "safe");
    el.addEventListener("sdui-action", (e) => {
      void this.sendAction({ sduiAction: (e as CustomEvent).detail });
    });
    el.props = { ...descriptor, library: { ...agentStackLibrary, ...descriptor.library } };
    host.appendChild(el);
  }

  private onA2uiClientMessage(msg: A2uiClientMessage) {
    if ("action" in msg) void this.sendAction({ a2uiAction: msg });
    else {
      this.pendingErrors.push(msg.error);
      this.options.onWarning?.(`A2UI error ${msg.error.code}: ${msg.error.message}`);
    }
  }

  private addUiBlock(): HTMLElement {
    const host = document.createElement("div");
    host.setAttribute("data-chat-ui", "");
    this.push({ kind: "ui", id: uid(), host });
    return host;
  }

  private startText(id: string) {
    this.serverStatus = undefined;
    const item = { kind: "text" as const, id, role: "assistant" as const, text: "", streaming: true };
    this.textItems.set(id, item);
    this.push(item);
    return item;
  }

  /** Ends a streamed assistant message and adds it to the history sent to the agent. */
  private commitText(item: Extract<ChatItem, { kind: "text" }>) {
    if (!item.streaming) return;
    item.streaming = false;
    this.history.push({ id: item.id, role: "assistant", content: item.text });
  }

  private lastTextId(): string | undefined {
    return [...this.textItems.keys()].pop();
  }

  private push(item: ChatItem) {
    this.items = [...this.items, item];
  }

  private changed() {
    this.options.onChange?.();
  }
}
