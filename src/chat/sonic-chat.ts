import "@supersoniks/concorde/core/components/ui/button/button";
import { LitElement, html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import { injectAgentStackStyles } from "../libraries/styles";
import { ChatSession, type ChatItem, type ChatLogEntry, type ChatStatus } from "./session";
import { HttpAgUiTransport, type AgentTransport } from "./transport";

/** Libellé d'un outil : texte fixe, ou fonction (arguments connus une fois l'appel complet, fait ?). */
export type ToolLabel = string | ((args: Record<string, unknown> | undefined, done: boolean) => string);

const chatCss = `
:where(sonic-chat) { display: flex; flex-direction: column; gap: var(--a2ui-gap, 0.75rem); min-height: 0; }
:where(sonic-chat [data-chat-log]) { display: flex; flex-direction: column; gap: var(--a2ui-gap, 0.75rem); overflow-y: auto; flex: 1; min-height: 0; }
:where(sonic-chat [data-chat-msg]) { white-space: pre-wrap; max-width: 85%; padding: 0.5rem 0.75rem; border-radius: var(--sc-rounded, 0.5rem); }
:where(sonic-chat [data-chat-msg="user"]) { align-self: flex-end; background: var(--sc-base-100, #f1f1f1); }
:where(sonic-chat [data-chat-msg="assistant"]) { align-self: flex-start; }
:where(sonic-chat [data-chat-tool], sonic-chat [data-chat-error]) { font-size: 0.85em; opacity: 0.8; }
:where(sonic-chat [data-chat-error]) { color: var(--sc-danger, #b42318); }
:where(sonic-chat [data-chat-tool], sonic-chat [data-chat-status]) { display: flex; align-items: center; gap: 0.5rem; }
:where(sonic-chat [data-chat-status]) { font-size: 0.9em; opacity: 0.85; align-self: flex-start; padding: 0.25rem 0.5rem; }
:where(sonic-chat [data-chat-status] [data-chat-elapsed]) { opacity: 0.6; font-variant-numeric: tabular-nums; }
:where(sonic-chat [data-chat-spinner]) { flex: none; width: 0.9em; height: 0.9em; border-radius: 50%; animation: sonic-chat-spin 0.8s linear infinite; }
/* Pas de :where() ici : doit l'emporter sur un reset « * { border-width: 0 } » (Tailwind preflight). */
sonic-chat [data-chat-spinner] { box-sizing: border-box; border: 2px solid currentColor; border-right-color: transparent; }
:where(sonic-chat [data-chat-tool-done]) { flex: none; width: 0.9em; text-align: center; color: var(--sc-success, currentColor); }
@keyframes sonic-chat-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { :where(sonic-chat [data-chat-spinner]) { animation-duration: 3s; } }
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
 * `forwardedProps` (property) is merged into every run (app context, e.g. the
 * artifact being edited). Other `CUSTOM` events surface as a `chat-custom`
 * DOM event `{name, value}`; run errors as `chat-run-error` `{message, code?}`.
 */
export class SonicChat extends LitElement {
  static properties = {
    endpoint: { type: String },
    placeholder: { type: String },
    transport: { attribute: false },
    headers: { attribute: false },
    forwardedProps: { attribute: false },
    toolLabels: { attribute: false },
    threadId: { type: String, attribute: "thread-id" },
    restoreEntries: { attribute: false },
  };

  endpoint = "";
  placeholder = "Votre message…";
  transport?: AgentTransport;
  headers?: Record<string, string>;
  forwardedProps?: Record<string, unknown>;
  /** Libellés lisibles des outils, par nom (« Recherche d'icônes »…). Défaut : le nom de l'outil. */
  toolLabels?: Record<string, ToolLabel>;

  /** Conversation id; changing it starts (or resumes) another thread. Default: a random one. */
  threadId?: string;
  /** Log of a past conversation to show and carry on (see `ChatSession.restore`). Set it with `threadId`. */
  restoreEntries?: ChatLogEntry[];

  session?: ChatSession;
  private draft = "";

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // Styles in the tree that hosts the chat (document or an app's shadow root).
    const root = this.getRootNode();
    this.styleRoot = root instanceof ShadowRoot ? root : document;
    injectAgentStackStyles(this.styleRoot);
    injectChatStyles(this.styleRoot);
  }

  private styleRoot: Document | ShadowRoot = document;
  private ticker?: ReturnType<typeof setInterval>;

  /** Redessine chaque seconde pendant un run (temps écoulé). */
  private syncTicker(running: boolean) {
    if (running && !this.ticker) this.ticker = setInterval(() => this.requestUpdate(), 1000);
    else if (!running && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.syncTicker(false);
    this.session?.destroy();
    this.session = undefined;
  }

  protected willUpdate(changed: PropertyValues) {
    // Headers and forwardedProps are read at run time: changing them keeps the conversation.
    if (
      !this.session ||
      changed.has("transport") ||
      changed.has("endpoint") ||
      changed.has("threadId") ||
      changed.has("restoreEntries")
    ) {
      const transport =
        this.transport ??
        (this.endpoint ? new HttpAgUiTransport({ url: this.endpoint, headers: () => this.headers }) : undefined);
      if (!transport) return;
      this.session?.destroy();
      this.session = new ChatSession({
        transport,
        threadId: this.threadId,
        styleTarget: this.styleRoot,
        forwardedProps: () => this.forwardedProps ?? {},
        onChange: () => this.requestUpdate(),
        onWarning: (w) => console.warn(`sonic-chat: ${w}`),
        onCustom: (name, value) =>
          this.dispatchEvent(new CustomEvent("chat-custom", { detail: { name, value }, bubbles: true, composed: true })),
        onRunEnd: () => this.dispatchEvent(new CustomEvent("chat-run-end", { bubbles: true, composed: true })),
        onRunError: (error) =>
          this.dispatchEvent(new CustomEvent("chat-run-error", { detail: error, bubbles: true, composed: true })),
      });
      if (this.restoreEntries?.length) this.session.restore(this.restoreEntries);
    }
  }

  /** Sends a message programmatically. */
  send(text: string) {
    return this.session?.send(text);
  }

  protected updated() {
    this.syncTicker(!!this.session?.running);
    const log = this.querySelector("[data-chat-log]");
    if (log) log.scrollTop = log.scrollHeight;
  }

  render() {
    const session = this.session;
    if (!session) return html`<p data-chat-error>sonic-chat : définir endpoint ou transport.</p>`;
    return html`
      <div data-chat-log role="log" aria-live="polite">
        ${repeat(session.items, (i) => i.id, (i) => this.renderItem(i))}
        ${this.renderStatus(session.status, session.runStartedAt)}
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
      case "tool": {
        // Un outil en cours est déjà montré par la ligne d'état (une seule animation).
        const status = this.session?.status;
        if (!item.done && status?.phase === "tool" && status.tool === item) return nothing;
        return html`<div data-chat-tool>
          ${item.done ? html`<span data-chat-tool-done aria-hidden="true">✓</span>` : html`<span data-chat-spinner aria-hidden="true"></span>`}
          <span>${this.toolLabel(item)}</span>
        </div>`;
      }
      case "error":
        return html`<div data-chat-error role="alert">${item.message}</div>`;
      default:
        return nothing;
    }
  }

  private toolLabel(item: Extract<ChatItem, { kind: "tool" }>): string {
    const label = this.toolLabels?.[item.name];
    if (typeof label === "function") return label(item.args, item.done);
    return label ?? item.name;
  }

  /** « L'agent travaille » : un état précis (outil en cours, rédaction…) et le temps écoulé. */
  private renderStatus(status: ChatStatus | null, startedAt: number) {
    if (!status) return nothing;
    const label =
      status.phase === "sending"
        ? "Envoi…"
        : status.phase === "thinking"
          ? "Réflexion…"
          : status.phase === "writing"
            ? "Rédaction de la réponse…"
            : status.phase === "custom"
              ? status.label
              : `${this.toolLabel(status.tool)}…`;
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    return html`<div data-chat-status data-phase=${status.phase} role="status">
      <span data-chat-spinner aria-hidden="true"></span>
      <span>${label}</span>
      ${seconds >= 3 ? html`<span data-chat-elapsed>${seconds} s</span>` : nothing}
    </div>`;
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

function injectChatStyles(target: Document | ShadowRoot = document) {
  if (target.getElementById("sonic-chat-styles")) return;
  const doc = target instanceof Document ? target : target.ownerDocument;
  const style = doc.createElement("style");
  style.id = "sonic-chat-styles";
  style.textContent = chatCss;
  if (target instanceof Document) target.head.appendChild(style);
  else target.appendChild(style);
}

if (!customElements.get("sonic-chat")) customElements.define("sonic-chat", SonicChat);

declare global {
  interface HTMLElementTagNameMap {
    "sonic-chat": SonicChat;
  }
}
