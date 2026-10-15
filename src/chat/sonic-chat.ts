import "@supersoniks/concorde/core/components/ui/button/button";
import { LitElement, html, nothing, svg, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import { injectAgentStackStyles } from "../libraries/styles";
import { ChatSession, type ChatItem, type ChatStatus } from "./session";
import { HttpAgUiTransport, type AgentTransport } from "./transport";

/** Libellé d'un outil : texte fixe, ou fonction (arguments connus une fois l'appel complet, fait ?). */
export type ToolLabel = string | ((args: Record<string, unknown> | undefined, done: boolean) => string);

/**
 * Le texte secondaire est atténué par mélange avec le fond (pas par `opacity`, qui
 * rend le contraste imprévisible) ; les contours de champ visent 3:1. Aucune couleur
 * en dur : tout dérive de `currentColor`, donc ça tient en thème clair comme sombre.
 */
const chatCss = `
:where(sonic-chat) { --a2ui-muted: color-mix(in srgb, currentColor 72%, transparent); display: flex; flex-direction: column; gap: var(--a2ui-gap, 0.75rem); min-height: 0; }
:where(sonic-chat [data-chat-log]) { display: flex; flex-direction: column; gap: var(--a2ui-gap, 0.75rem); overflow-y: auto; flex: 1; min-height: 0; }
:where(sonic-chat [data-chat-log]:focus-visible, sonic-chat textarea:focus-visible) { outline: 2px solid var(--sc-primary, currentColor); outline-offset: 2px; }
:where(sonic-chat [data-chat-msg]) { white-space: pre-wrap; overflow-wrap: anywhere; max-width: min(85%, 70ch); padding: 0.5rem 0.75rem; border-radius: var(--sc-rounded, 0.5rem); }
:where(sonic-chat [data-chat-msg="user"]) { align-self: flex-end; background: var(--sc-base-100, color-mix(in srgb, currentColor 8%, transparent)); }
:where(sonic-chat [data-chat-msg="assistant"]) { align-self: flex-start; }
:where(sonic-chat [data-chat-tool], sonic-chat [data-chat-error]) { font-size: 0.875em; color: var(--a2ui-muted); }
:where(sonic-chat [data-chat-error]) { color: var(--sc-danger, #b42318); display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem 0.75rem; }
:where(sonic-chat [data-chat-tool], sonic-chat [data-chat-status]) { display: flex; align-items: center; gap: 0.5rem; }
:where(sonic-chat [data-chat-status]) { font-size: 0.9em; color: var(--a2ui-muted); align-self: flex-start; padding: 0.25rem 0.5rem; }
:where(sonic-chat [data-chat-status] [data-chat-elapsed]) { font-variant-numeric: tabular-nums; }
:where(sonic-chat [data-chat-empty]) { margin: auto; max-width: 40ch; text-align: center; color: var(--a2ui-muted); }
:where(sonic-chat [data-chat-sr]) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
:where(sonic-chat [data-chat-spinner]) { flex: none; width: 0.9em; height: 0.9em; border-radius: 50%; animation: sonic-chat-spin 0.8s linear infinite; }
/* Pas de :where() ici : doit l'emporter sur un reset « * { border-width: 0 } » (Tailwind preflight). */
sonic-chat [data-chat-spinner] { box-sizing: border-box; border: 2px solid currentColor; border-right-color: transparent; }
:where(sonic-chat [data-chat-tool-done]) { flex: none; display: inline-flex; width: 0.9em; height: 0.9em; color: var(--sc-success, currentColor); }
:where(sonic-chat [data-chat-tool-done] svg) { width: 100%; height: 100%; }
@keyframes sonic-chat-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { :where(sonic-chat [data-chat-spinner]) { animation-duration: 3s; } }
/* Un run est en cours : le clic sur une action est ignoré par la session, donc on le montre. */
:where(sonic-chat[data-running] [data-chat-block] sonic-button) { pointer-events: none; opacity: 0.6; }
:where(sonic-chat form) { display: flex; gap: 0.5rem; align-items: flex-end; }
/* 16px minimum : en dessous, iOS Safari zoome la page au focus. 44px de haut : cible tactile. */
:where(sonic-chat textarea) { flex: 1; resize: vertical; min-height: 2.75rem; font: inherit; font-size: max(1rem, 16px); padding: 0.5rem 0.75rem; border-radius: var(--sc-rounded, 0.5rem); border: 1px solid var(--a2ui-field-border, color-mix(in srgb, currentColor 50%, transparent)); }
`;

/** Coche tracée (un seul trait, comme le reste de l'UI) : pas de glyphe Unicode. */
const checkIcon = svg`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5"/></svg>`;

/** Distance au bas du journal en deçà de laquelle on suit le flux (px). */
const PINNED_THRESHOLD = 48;

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
 *
 * Comportements : Entrée envoie (Maj+Entrée = retour à la ligne, et pas pendant
 * une saisie IME), le journal suit le flux sauf si on a remonté pour relire,
 * le focus revient dans la saisie après un envoi, un échec propose « Réessayer ».
 * Pendant un run, l'attribut `data-running` est posé sur l'élément.
 */
export class SonicChat extends LitElement {
  static properties = {
    endpoint: { type: String },
    placeholder: { type: String },
    /** Message affiché tant que la conversation est vide (rien par défaut). */
    emptyText: { type: String, attribute: "empty-text" },
    /** Nom accessible du journal de conversation. */
    logLabel: { type: String, attribute: "log-label" },
    /** Abandonne un run sans événement depuis N ms (0 = jamais). Défaut : 60000. */
    idleTimeoutMs: { type: Number, attribute: "idle-timeout-ms" },
    transport: { attribute: false },
    headers: { attribute: false },
    forwardedProps: { attribute: false },
    toolLabels: { attribute: false },
    draft: { state: true },
  };

  endpoint = "";
  placeholder = "Votre message…";
  emptyText = "";
  logLabel = "Conversation";
  idleTimeoutMs = 60_000;
  transport?: AgentTransport;
  headers?: Record<string, string>;
  forwardedProps?: Record<string, unknown>;
  /** Libellés lisibles des outils, par nom (« Recherche d'icônes »…). Défaut : le nom de l'outil. */
  toolLabels?: Record<string, ToolLabel>;

  session?: ChatSession;
  private draft = "";
  /** Vrai tant que le lecteur est en bas du journal : seulement alors, un nouveau contenu le fait défiler. */
  private pinned = true;

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
    if (!this.session || changed.has("transport") || changed.has("endpoint")) {
      const transport =
        this.transport ??
        (this.endpoint ? new HttpAgUiTransport({ url: this.endpoint, headers: () => this.headers }) : undefined);
      if (!transport) return;
      this.session?.destroy();
      this.session = new ChatSession({
        transport,
        styleTarget: this.styleRoot,
        forwardedProps: () => this.forwardedProps ?? {},
        idleTimeoutMs: this.idleTimeoutMs,
        onRunEnd: (diagnostics) =>
          this.dispatchEvent(new CustomEvent("chat-run-end", { detail: diagnostics, bubbles: true, composed: true })),
        onChange: () => this.requestUpdate(),
        onWarning: (w) => console.warn(`sonic-chat: ${w}`),
        onCustom: (name, value) =>
          this.dispatchEvent(new CustomEvent("chat-custom", { detail: { name, value }, bubbles: true, composed: true })),
        onRunError: (error) =>
          this.dispatchEvent(new CustomEvent("chat-run-error", { detail: error, bubbles: true, composed: true })),
      });
    }
  }

  /** Sends a message programmatically. */
  send(text: string) {
    this.pinned = true;
    return this.session?.send(text);
  }

  protected updated() {
    const running = !!this.session?.running;
    this.syncTicker(running);
    this.toggleAttribute("data-running", running);
    const log = this.querySelector("[data-chat-log]");
    if (log && this.pinned) log.scrollTop = log.scrollHeight;
  }

  render() {
    const session = this.session;
    if (!session) return html`<p data-chat-error>sonic-chat : définir endpoint ou transport.</p>`;
    const empty = !session.items.length && !session.running && this.emptyText;
    return html`
      <div
        data-chat-log
        role="log"
        aria-live="polite"
        aria-label=${this.logLabel}
        tabindex="0"
        @scroll=${this.onScroll}
      >
        ${empty ? html`<p data-chat-empty>${this.emptyText}</p>` : nothing}
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
          ? html`<sonic-button type="default" @click=${this.onStop}>Arrêter</sonic-button>`
          : html`<sonic-button type="primary" ?disabled=${!this.draft.trim()} @click=${this.onSubmit}>Envoyer</sonic-button>`}
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
          ${item.done
            ? html`<span data-chat-tool-done aria-hidden="true">${checkIcon}</span>`
            : html`<span data-chat-spinner aria-hidden="true"></span>`}
          <span>${this.toolLabel(item)}</span>
          ${item.done ? html`<span data-chat-sr>(terminé)</span>` : nothing}
        </div>`;
      }
      case "error": {
        // Le dernier échec se rejoue d'un clic : l'historique et l'action sont conservés.
        const session = this.session;
        const retryable = !!session && !session.running && session.items[session.items.length - 1] === item;
        return html`<div data-chat-error role="alert">
          <span>${item.message}</span>
          ${retryable ? html`<sonic-button size="sm" variant="outline" @click=${this.onRetry}>Réessayer</sonic-button>` : nothing}
        </div>`;
      }
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
    // Le chrono est décoratif : dans une zone live, il serait annoncé chaque seconde.
    return html`<div data-chat-status data-phase=${status.phase} role="status">
      <span data-chat-spinner aria-hidden="true"></span>
      <span>${label}</span>
      ${seconds >= 3 ? html`<span data-chat-elapsed aria-hidden="true">${seconds} s</span>` : nothing}
    </div>`;
  }

  private onScroll = (e: Event) => {
    const log = e.currentTarget as HTMLElement;
    this.pinned = log.scrollHeight - log.scrollTop - log.clientHeight <= PINNED_THRESHOLD;
  };

  private onKeydown = (e: KeyboardEvent) => {
    // Entrée qui valide une composition IME (accents, CJK) ne doit pas envoyer le message.
    const composing = e.isComposing || (e as KeyboardEvent & { keyCode?: number }).keyCode === 229;
    if (e.key === "Enter" && !e.shiftKey && !composing) this.onSubmit(e);
  };

  private onSubmit = (e: Event) => {
    e.preventDefault();
    if (!this.session || this.session.running) return;
    const text = this.draft.trim();
    if (!text) return;
    this.draft = "";
    this.pinned = true;
    void this.session.send(text);
    this.focusInput();
  };

  private onStop = () => {
    this.session?.stop();
    this.focusInput();
  };

  private onRetry = () => {
    this.pinned = true;
    void this.session?.retry();
    this.focusInput();
  };

  /** Le bouton cliqué change de nature (Envoyer / Arrêter) : le focus repart dans la saisie, pas dans le vide. */
  private focusInput() {
    void this.updateComplete.then(() => this.querySelector("textarea")?.focus());
  }
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
