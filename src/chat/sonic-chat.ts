import "@supersoniks/concorde/core/components/ui/button/button";
import { LitElement, html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import { injectAgentStackStyles } from "../libraries/styles";
import { ChatSession, type ChatItem } from "./session";
import { HttpAgUiTransport, type AgentTransport } from "./transport";

const chatCss = `
:where(sonic-chat) { display: flex; flex-direction: column; gap: var(--a2ui-gap, 0.75rem); min-height: 0; }
:where(sonic-chat [data-chat-log]) { display: flex; flex-direction: column; gap: var(--a2ui-gap, 0.75rem); overflow-y: auto; flex: 1; min-height: 0; }
:where(sonic-chat [data-chat-msg]) { white-space: pre-wrap; max-width: 85%; padding: 0.5rem 0.75rem; border-radius: var(--sc-rounded, 0.5rem); }
:where(sonic-chat [data-chat-msg="user"]) { align-self: flex-end; background: var(--sc-base-100, #f1f1f1); }
:where(sonic-chat [data-chat-msg="assistant"]) { align-self: flex-start; }
:where(sonic-chat [data-chat-tool], sonic-chat [data-chat-error]) { font-size: 0.85em; opacity: 0.8; }
:where(sonic-chat [data-chat-error]) { color: var(--sc-danger, #b42318); }
:where(sonic-chat form) { display: flex; gap: 0.5rem; align-items: flex-end; }
:where(sonic-chat textarea) { flex: 1; resize: vertical; min-height: 2.5rem; font: inherit; padding: 0.5rem; border-radius: var(--sc-rounded, 0.5rem); border: 1px solid var(--sc-base-300, #ccc); }
`;

/**
 * `<sonic-chat endpoint="/agent">` — conversation UI over AG-UI.
 *
 * Text is always rendered as plain text. UI blocks (A2UI surfaces, SDUI
 * descriptors) are rendered by `sonic-sdui` in `profile="safe"`.
 * Rendered in light DOM so Concorde themes and ancestor attributes apply.
 *
 * Set `transport` (property) to plug another transport; otherwise `endpoint`
 * is used with `HttpAgUiTransport`. `headers` (property) is sent with each run.
 */
export class SonicChat extends LitElement {
  static properties = {
    endpoint: { type: String },
    placeholder: { type: String },
    transport: { attribute: false },
    headers: { attribute: false },
  };

  endpoint = "";
  placeholder = "Votre message…";
  transport?: AgentTransport;
  headers?: Record<string, string>;

  session?: ChatSession;
  private draft = "";

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    injectAgentStackStyles();
    injectChatStyles();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.session?.destroy();
    this.session = undefined;
  }

  protected willUpdate(changed: PropertyValues) {
    if (!this.session || changed.has("transport") || changed.has("endpoint") || changed.has("headers")) {
      const transport =
        this.transport ?? (this.endpoint ? new HttpAgUiTransport({ url: this.endpoint, headers: this.headers }) : undefined);
      if (!transport) return;
      this.session?.destroy();
      this.session = new ChatSession({
        transport,
        onChange: () => this.requestUpdate(),
        onWarning: (w) => console.warn(`sonic-chat: ${w}`),
      });
    }
  }

  /** Sends a message programmatically. */
  send(text: string) {
    return this.session?.send(text);
  }

  protected updated() {
    const log = this.querySelector("[data-chat-log]");
    if (log) log.scrollTop = log.scrollHeight;
  }

  render() {
    const session = this.session;
    if (!session) return html`<p data-chat-error>sonic-chat : définir endpoint ou transport.</p>`;
    return html`
      <div data-chat-log role="log" aria-live="polite">
        ${repeat(session.items, (i) => i.id, (i) => this.renderItem(i))}
      </div>
      <form @submit=${this.onSubmit}>
        <textarea
          rows="1"
          .value=${live(this.draft)}
          placeholder=${this.placeholder}
          aria-label=${this.placeholder}
          @input=${(e: Event) => (this.draft = (e.target as HTMLTextAreaElement).value)}
          @keydown=${this.onKeydown}
        ></textarea>
        ${session.running
          ? html`<sonic-button type="default" @click=${() => session.stop()}>Arrêter</sonic-button>`
          : html`<sonic-button type="primary" @click=${this.onSubmit}>Envoyer</sonic-button>`}
      </form>
    `;
  }

  private renderItem(item: ChatItem) {
    switch (item.kind) {
      case "text":
        return html`<div data-chat-msg=${item.role} ?data-streaming=${item.streaming}>${item.text}</div>`;
      case "ui":
        return html`<div data-chat-block>${item.host}</div>`;
      case "tool":
        return html`<div data-chat-tool>${item.done ? "✓" : "…"} ${item.name}</div>`;
      case "error":
        return html`<div data-chat-error role="alert">${item.message}</div>`;
      default:
        return nothing;
    }
  }

  private onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) this.onSubmit(e);
  };

  private onSubmit = (e: Event) => {
    e.preventDefault();
    if (!this.session || this.session.running) return;
    const text = this.draft;
    this.draft = "";
    this.requestUpdate();
    void this.session.send(text);
  };
}

function injectChatStyles(doc: Document = document) {
  if (doc.getElementById("sonic-chat-styles")) return;
  const style = doc.createElement("style");
  style.id = "sonic-chat-styles";
  style.textContent = chatCss;
  doc.head.appendChild(style);
}

if (!customElements.get("sonic-chat")) customElements.define("sonic-chat", SonicChat);

declare global {
  interface HTMLElementTagNameMap {
    "sonic-chat": SonicChat;
  }
}
