import "@supersoniks/concorde/core/components/ui/button/button";
import { LitElement, html, nothing, svg, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import { injectAgentStackStyles } from "../libraries/styles";
import { ChatSession, type ChatItem, type ChatLogEntry, type ChatStatus } from "./session";
import {
  AttachmentError,
  attachmentMeta,
  DEFAULT_ACCEPT,
  fileAttachment,
  formatSize,
  isLongPaste,
  textAttachment,
  type AttachmentMeta,
  type ChatAttachment,
} from "./attachments";
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
:where(sonic-chat [data-chat-msg][data-chat-md]) { white-space: normal; }
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
:where(sonic-chat form) { flex-wrap: wrap; }
:where(sonic-chat [data-chat-compose]) { display: flex; gap: 0.5rem; align-items: flex-end; flex: 1 1 100%; }
:where(sonic-chat[data-dragging] [data-chat-compose] textarea) { outline: 2px dashed var(--sc-primary, currentColor); outline-offset: 2px; }
:where(sonic-chat [data-chat-attach-btn]) { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 2.75rem; height: 2.75rem; border-radius: var(--sc-rounded, 0.5rem); border: 1px solid var(--a2ui-field-border, color-mix(in srgb, currentColor 50%, transparent)); background: transparent; color: inherit; cursor: pointer; }
:where(sonic-chat [data-chat-attach-btn] svg) { width: 1.2em; height: 1.2em; }
:where(sonic-chat [data-chat-attach-btn]:focus-visible) { outline: 2px solid var(--sc-primary, currentColor); outline-offset: 2px; }
:where(sonic-chat [data-chat-attachments]) { display: flex; flex-wrap: wrap; gap: 0.5rem; flex: 1 1 100%; }
:where(sonic-chat [data-chat-attachment]) { display: inline-flex; align-items: center; gap: 0.4rem; max-width: 100%; padding: 0.25rem 0.4rem 0.25rem 0.25rem; border-radius: var(--sc-rounded, 0.5rem); border: 1px solid color-mix(in srgb, currentColor 25%, transparent); font-size: 0.85em; }
:where(sonic-chat [data-chat-attachment] img) { width: 2.25rem; height: 2.25rem; object-fit: cover; border-radius: calc(var(--sc-rounded, 0.5rem) / 2); }
:where(sonic-chat [data-chat-attachment] [data-chat-file-icon]) { display: inline-flex; width: 2.25rem; height: 2.25rem; align-items: center; justify-content: center; border-radius: calc(var(--sc-rounded, 0.5rem) / 2); background: color-mix(in srgb, currentColor 10%, transparent); font-size: 0.7em; font-weight: 600; text-transform: uppercase; }
:where(sonic-chat [data-chat-attachment] [data-chat-att-name]) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 16ch; }
:where(sonic-chat [data-chat-attachment] [data-chat-att-size]) { color: var(--a2ui-muted); white-space: nowrap; }
:where(sonic-chat [data-chat-attachment] button) { border: 0; background: transparent; color: inherit; cursor: pointer; padding: 0 0.2rem; font-size: 1.1em; line-height: 1; }
:where(sonic-chat [data-chat-attachment] details) { flex: 1 1 100%; }
:where(sonic-chat [data-chat-attachment] pre) { max-height: 10rem; overflow: auto; margin: 0.25rem 0 0; white-space: pre-wrap; font-size: 0.85em; }
:where(sonic-chat [data-chat-attach-error]) { flex: 1 1 100%; color: var(--sc-danger, #b42318); font-size: 0.875em; margin: 0; }
:where(sonic-chat [data-chat-msg] [data-chat-attachments]) { margin-top: 0.4rem; justify-content: flex-end; }
:where(sonic-chat [data-chat-msg] [data-chat-attachment] img) { width: 5rem; height: 5rem; }
:where(sonic-chat [data-chat-steps], sonic-chat details[data-chat-tool]) { font-size: 0.875em; color: var(--a2ui-muted); }
:where(sonic-chat [data-chat-steps] > summary, sonic-chat details[data-chat-tool] > summary) { cursor: pointer; display: flex; align-items: center; gap: 0.5rem; list-style: none; border-radius: 0.25rem; }
:where(sonic-chat [data-chat-steps] > summary::-webkit-details-marker, sonic-chat details[data-chat-tool] > summary::-webkit-details-marker) { display: none; }
:where(sonic-chat [data-chat-steps] > summary::before, sonic-chat details[data-chat-tool] > summary::before) { content: ""; flex: none; width: 0.4em; height: 0.4em; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(-45deg); transition: transform 0.15s; }
:where(sonic-chat [data-chat-steps][open] > summary::before, sonic-chat details[data-chat-tool][open] > summary::before) { transform: rotate(45deg); }
:where(sonic-chat [data-chat-steps] > summary:focus-visible, sonic-chat details[data-chat-tool] > summary:focus-visible) { outline: 2px solid var(--sc-primary, currentColor); outline-offset: 2px; }
:where(sonic-chat [data-chat-steps-list]) { display: flex; flex-direction: column; gap: 0.35rem; margin: 0.35rem 0 0 0.25rem; padding-left: 0.75rem; border-left: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
:where(sonic-chat [data-chat-tool-detail]) { margin: 0.35rem 0 0.25rem 1.4rem; display: flex; flex-direction: column; gap: 0.35rem; }
:where(sonic-chat [data-chat-tool-detail] pre) { margin: 0; max-height: 14rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.85em; padding: 0.4rem 0.5rem; border-radius: 0.375rem; background: color-mix(in srgb, currentColor 7%, transparent); color: inherit; }
:where(sonic-chat [data-chat-tool-detail] [data-chat-detail-label]) { font-weight: 600; }
:where(sonic-chat [data-chat-duration]) { font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { :where(sonic-chat [data-chat-steps] > summary::before, sonic-chat details[data-chat-tool] > summary::before) { transition: none; } }
`;

/** Coche tracée (un seul trait, comme le reste de l'UI) : pas de glyphe Unicode. */
const checkIcon = svg`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5"/></svg>`;

/** Trombone (pièce jointe), un seul trait. */
const clipIcon = svg`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 7.5l-5.6 5.6a3.2 3.2 0 0 1-4.5-4.5l5.9-5.9a2.1 2.1 0 0 1 3 3l-5.9 5.9a1 1 0 0 1-1.5-1.5l5.3-5.3"/></svg>`;

/** Taille max d'un détail affiché (arguments, résultat) avant coupe. */
const MAX_DETAIL = 4000;

/** Distance au bas du journal en deçà de laquelle on suit le flux (px). */
const PINNED_THRESHOLD = 48;

/**
 * `<sonic-chat endpoint="/agent">` — conversation UI over AG-UI.
 *
 * Text is rendered as plain text. With `markdown`, the agent's messages (and
 * Markdown A2UI `Text`) are rendered by `sonic-markdown` (addon `markdown` of
 * `@supersoniks/creative-stack`, loaded by the host; plain text until it is
 * defined); the user's messages stay plain. UI blocks (A2UI surfaces, SDUI
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
 * le focus revient dans la saisie après un envoi, un échec propose « Continuer » (envoie « Continue » comme si l'utilisateur l'avait tapé).
 * Pendant un run, l'attribut `data-running` est posé sur l'élément.
 *
 * Avec `attachments` : bouton trombone, coller (images, fichiers) et glisser-déposer ajoutent des
 * pièces jointes (images réduites, PDF, fichiers texte) envoyées en `InputContent` AG-UI ; un long
 * texte collé devient une pièce jointe « Texte collé » repliée (aperçu dépliable) au lieu
 * d'inonder la saisie. Les étapes (appels d'outils) se déplient (paramètres, résultat, durée) ;
 * plusieurs étapes consécutives forment un groupe ouvert pendant le run, replié ensuite.
 */
export class SonicChat extends LitElement {
  static properties = {
    endpoint: { type: String },
    placeholder: { type: String },
    /** Message affiché tant que la conversation est vide (rien par défaut). */
    emptyText: { type: String, attribute: "empty-text" },
    /** Nom accessible du journal de conversation. */
    logLabel: { type: String, attribute: "log-label" },
    /** Libellé du bouton proposé après un échec. Défaut : « Continuer ». */
    continueLabel: { type: String, attribute: "continue-label" },
    /** Message envoyé par ce bouton, comme si l'utilisateur l'avait tapé. Défaut : « Continue ». */
    continueText: { type: String, attribute: "continue-text" },
    /** Abandonne un run sans événement depuis N ms (0 = jamais). Défaut : 60000. */
    idleTimeoutMs: { type: Number, attribute: "idle-timeout-ms" },
    transport: { attribute: false },
    headers: { attribute: false },
    forwardedProps: { attribute: false },
    toolLabels: { attribute: false },
    draft: { state: true },
    threadId: { type: String, attribute: "thread-id" },
    restoreEntries: { attribute: false },
    /** Messages de l'agent en Markdown (`sonic-markdown`). Lu à la création de la session pour les surfaces A2UI. */
    markdown: { type: Boolean },
    /** Pièces jointes : bouton, coller, glisser-déposer (images, PDF, fichiers texte) ; longs textes collés repliés. */
    attachments: { type: Boolean },
    /** Types acceptés (attribut `accept` du sélecteur de fichiers). */
    accept: { type: String },
    /** Nombre maximal de pièces jointes par message. Défaut : 6. */
    maxAttachments: { type: Number, attribute: "max-attachments" },
    /** Étapes (appels d'outils) dépliables : arguments, résultat, durée. Défaut : vrai. */
    stepDetails: { type: Boolean, attribute: "step-details" },
    pending: { state: true },
    attachError: { state: true },
  };

  endpoint = "";
  placeholder = "Votre message…";
  emptyText = "";
  logLabel = "Conversation";
  continueLabel = "Continuer";
  continueText = "Continue";
  idleTimeoutMs = 60_000;
  markdown = false;
  attachments = false;
  accept = DEFAULT_ACCEPT;
  maxAttachments = 6;
  stepDetails = true;
  /** Pièces jointes du message en cours de saisie. */
  pending: ChatAttachment[] = [];
  private attachError = "";
  /** Groupes d'étapes ouverts ou fermés par l'utilisateur (id du premier outil → ouvert ?). */
  private stepGroups = new Map<string, boolean>();
  private pasteCount = 0;
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
    this.addEventListener("dragover", this.onDragOver);
    this.addEventListener("dragleave", this.onDragLeave);
    this.addEventListener("drop", this.onDrop);
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
    this.removeEventListener("dragover", this.onDragOver);
    this.removeEventListener("dragleave", this.onDragLeave);
    this.removeEventListener("drop", this.onDrop);
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
        idleTimeoutMs: this.idleTimeoutMs,
        markdown: this.markdown,
        onRunEnd: (diagnostics) =>
          this.dispatchEvent(new CustomEvent("chat-run-end", { detail: diagnostics, bubbles: true, composed: true })),
        onChange: () => this.requestUpdate(),
        onWarning: (w) => console.warn(`sonic-chat: ${w}`),
        onCustom: (name, value) =>
          this.dispatchEvent(new CustomEvent("chat-custom", { detail: { name, value }, bubbles: true, composed: true })),
        onRunError: (error) =>
          this.dispatchEvent(new CustomEvent("chat-run-error", { detail: error, bubbles: true, composed: true })),
      });
      if (this.restoreEntries?.length) this.session.restore(this.restoreEntries);
    }
  }

  /** Sends a message programmatically (with optional attachments). */
  send(text: string, attachments: ChatAttachment[] = []) {
    this.pinned = true;
    return this.session?.send(text, attachments);
  }

  /** Ajoute des fichiers aux pièces jointes du message en cours (bouton, coller, déposer). */
  async addFiles(files: Iterable<File>) {
    this.attachError = "";
    for (const file of files) {
      if (this.pending.length >= this.maxAttachments) {
        this.attachError = `${this.maxAttachments} pièces jointes au plus par message.`;
        break;
      }
      try {
        this.pending = [...this.pending, await fileAttachment(file)];
      } catch (e) {
        this.attachError = e instanceof AttachmentError ? e.message : `« ${file.name} » : lecture impossible.`;
      }
    }
  }

  private addPastedText(text: string) {
    if (this.pending.length >= this.maxAttachments) {
      this.attachError = `${this.maxAttachments} pièces jointes au plus par message.`;
      return;
    }
    this.pasteCount++;
    this.pending = [...this.pending, textAttachment(text, this.pasteCount)];
  }

  private removeAttachment(id: string) {
    this.pending = this.pending.filter((a) => a.id !== id);
    this.attachError = "";
    this.focusInput();
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
    const canSend = !!this.draft.trim() || this.pending.length > 0;
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
        ${this.renderItems(session.items, session.running)}
        ${this.renderStatus(session.status, session.runStartedAt)}
      </div>
      <form @submit=${this.onSubmit}>
        ${this.attachments && this.pending.length
          ? html`<div data-chat-attachments aria-label="Pièces jointes">
              ${this.pending.map((a) => this.renderAttachment(attachmentMeta(a), a.id, a.text))}
            </div>`
          : nothing}
        ${this.attachError ? html`<p data-chat-attach-error role="alert">${this.attachError}</p>` : nothing}
        <div data-chat-compose>
          ${this.attachments
            ? html`<button
                  type="button"
                  data-chat-attach-btn
                  title="Joindre un fichier (image, PDF, texte)"
                  aria-label="Joindre un fichier"
                  @click=${() => (this.querySelector("[data-chat-file]") as HTMLInputElement | null)?.click()}
                >
                  ${clipIcon}
                </button>
                <input
                  type="file"
                  data-chat-file
                  hidden
                  multiple
                  accept=${this.accept}
                  @change=${this.onFilePicked}
                />`
            : nothing}
          <textarea
            rows="1"
            .value=${live(this.draft)}
            placeholder=${this.placeholder}
            aria-label=${this.placeholder}
            @input=${(e: Event) => (this.draft = (e.target as HTMLTextAreaElement).value)}
            @keydown=${this.onKeydown}
            @paste=${this.onPaste}
          ></textarea>
          ${session.running
            ? html`<sonic-button type="default" @click=${this.onStop}>Arrêter</sonic-button>`
            : html`<sonic-button type="primary" ?disabled=${!canSend} @click=${this.onSubmit}>Envoyer</sonic-button>`}
        </div>
      </form>
    `;
  }

  /** Pièce jointe : vignette ou type, nom, taille ; retrait (saisie) ; aperçu du texte. */
  private renderAttachment(a: AttachmentMeta, removeId?: string, text?: string) {
    const ext = (a.name.match(/\.([a-z0-9]{1,4})$/i)?.[1] ?? (a.kind === "text" ? "txt" : a.mimeType.split("/")[1] ?? "")).slice(0, 4);
    const size = a.kind === "text" && (a.lines ?? 0) > 1 ? `${a.lines} lignes` : formatSize(a.size);
    return html`<span data-chat-attachment data-kind=${a.kind}>
      ${a.previewUrl ? html`<img src=${a.previewUrl} alt="" />` : html`<span data-chat-file-icon aria-hidden="true">${ext}</span>`}
      <span data-chat-att-name title=${a.name}>${a.name}</span>
      <span data-chat-att-size>${size}</span>
      ${removeId
        ? html`<button type="button" aria-label=${`Retirer ${a.name}`} title="Retirer" @click=${() => this.removeAttachment(removeId)}>×</button>`
        : nothing}
      ${text !== undefined
        ? html`<details>
            <summary>Aperçu</summary>
            <pre>${text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}…` : text}</pre>
          </details>`
        : nothing}
    </span>`;
  }

  /**
   * Éléments du fil ; les appels d'outils consécutifs forment un groupe « Étapes » dépliable :
   * ouvert pendant le run en cours, replié ensuite (sauf choix de l'utilisateur).
   */
  private renderItems(items: ChatItem[], running: boolean) {
    if (!this.stepDetails) return repeat(items, (i) => i.id, (i) => this.renderItem(i));
    type Seg = { key: string; tools?: Extract<ChatItem, { kind: "tool" }>[]; item?: ChatItem };
    const segs: Seg[] = [];
    for (const item of items) {
      const last = segs[segs.length - 1];
      if (item.kind === "tool") {
        if (last?.tools) last.tools.push(item);
        else segs.push({ key: `steps-${item.id}`, tools: [item] });
      } else segs.push({ key: item.id, item });
    }
    const lastSeg = segs[segs.length - 1];
    return repeat(
      segs,
      (s) => s.key,
      (s) => {
        if (s.item) return this.renderItem(s.item);
        const tools = s.tools!;
        if (tools.length === 1) return this.renderTool(tools[0]);
        const current = running && s === lastSeg;
        const open = this.stepGroups.get(s.key) ?? current;
        const done = tools.filter((t) => t.done).length;
        const ms = this.duration(tools[0].startedAt, tools[tools.length - 1].endedAt);
        return html`<details
          data-chat-steps
          .open=${open}
          @toggle=${(e: Event) => {
            const isOpen = (e.currentTarget as HTMLDetailsElement).open;
            if (isOpen !== open) this.stepGroups.set(s.key, isOpen);
          }}
        >
          <summary>
            ${current && done < tools.length
              ? html`<span data-chat-spinner aria-hidden="true"></span>`
              : html`<span data-chat-tool-done aria-hidden="true">${checkIcon}</span>`}
            <span>${tools.length} étapes${current && done < tools.length ? ` · ${done} terminées` : ""}</span>
            ${ms ? html`<span data-chat-duration>${ms}</span>` : nothing}
          </summary>
          <div data-chat-steps-list>${tools.map((t) => this.renderTool(t))}</div>
        </details>`;
      },
    );
  }

  private duration(start?: number, end?: number): string {
    if (!start || !end || end < start) return "";
    const ms = end - start;
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0).replace(".", ",")} s`;
  }

  /** Une étape : libellé, durée ; dépliée, ses arguments et son résultat. */
  private renderTool(item: Extract<ChatItem, { kind: "tool" }>) {
    // Un outil en cours est déjà montré par la ligne d'état (une seule animation).
    const status = this.session?.status;
    if (!item.done && status?.phase === "tool" && status.tool === item) return nothing;
    const icon = item.done
      ? html`<span data-chat-tool-done aria-hidden="true">${checkIcon}</span>`
      : html`<span data-chat-spinner aria-hidden="true"></span>`;
    const label = html`${icon}<span>${this.toolLabel(item)}</span>
      ${item.done ? html`<span data-chat-sr>(terminé)</span>` : nothing}
      ${this.duration(item.startedAt, item.endedAt) ? html`<span data-chat-duration>${this.duration(item.startedAt, item.endedAt)}</span>` : nothing}`;
    const hasArgs = !!item.args && Object.keys(item.args).length > 0;
    if (!this.stepDetails || (!hasArgs && !item.result)) return html`<div data-chat-tool>${label}</div>`;
    return html`<details data-chat-tool>
      <summary>${label}</summary>
      <div data-chat-tool-detail>
        <span data-chat-detail-label>${item.name}</span>
        ${hasArgs ? html`<span data-chat-detail-label>Paramètres</span><pre>${clip(pretty(item.args))}</pre>` : nothing}
        ${item.result ? html`<span data-chat-detail-label>Résultat</span><pre>${clip(pretty(item.result))}</pre>` : nothing}
      </div>
    </details>`;
  }

  private renderItem(item: ChatItem) {
    switch (item.kind) {
      case "text":
        if (this.markdown && item.role === "assistant" && customElements.get("sonic-markdown")) {
          // Rendu incrémental pendant le flux, rendu complet à la fin (liens par référence, notes).
          return html`<div data-chat-msg=${item.role} data-chat-md ?data-streaming=${item.streaming}><sonic-markdown
            .text=${item.text}
            ?streaming=${item.streaming}
            features="gfm highlight math copy"
            heading-offset="2"
          ></sonic-markdown></div>`;
        }
        return html`<div data-chat-msg=${item.role} ?data-streaming=${item.streaming}>${item.text}${item.attachments?.length
          ? html`<div data-chat-attachments>${item.attachments.map((a) => this.renderAttachment(a))}</div>`
          : nothing}</div>`;
      case "ui":
        return html`<div data-chat-block>${item.host}</div>`;
      case "tool":
        return this.renderTool(item);
      case "error": {
        // Après le dernier échec, un clic envoie « Continue » : le fil et son historique sont conservés.
        const session = this.session;
        const continuable = !!session && !session.running && session.items[session.items.length - 1] === item;
        return html`<div data-chat-error role="alert">
          <span>${item.message}</span>
          ${continuable ? html`<sonic-button size="sm" variant="outline" data-chat-continue @click=${this.onContinue}>${this.continueLabel}</sonic-button>` : nothing}
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
    const steps = this.runSteps();
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    // Le chrono est décoratif : dans une zone live, il serait annoncé chaque seconde.
    return html`<div data-chat-status data-phase=${status.phase} role="status">
      <span data-chat-spinner aria-hidden="true"></span>
      <span>${label}</span>
      ${steps > 1 ? html`<span data-chat-step-count>étape ${steps}</span>` : nothing}
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
    if (!text && !this.pending.length) return;
    const attachments = this.pending;
    this.draft = "";
    this.pending = [];
    this.attachError = "";
    this.pinned = true;
    void this.session.send(text, attachments);
    this.focusInput();
  };

  /** Étapes (outils) du run en cours. */
  private runSteps(): number {
    const session = this.session;
    if (!session?.running) return 0;
    let n = 0;
    for (const item of session.items) if (item.kind === "tool" && (item.startedAt ?? 0) >= session.runStartedAt) n++;
    return n;
  }

  private onFilePicked = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    void this.addFiles(files).then(() => this.focusInput());
  };

  /** Coller : fichiers et images deviennent des pièces jointes, un long texte aussi. */
  private onPaste = (e: ClipboardEvent) => {
    if (!this.attachments) return;
    const data = e.clipboardData;
    if (!data) return;
    const files = [...data.files];
    if (files.length) {
      e.preventDefault();
      void this.addFiles(files);
      return;
    }
    const text = data.getData("text/plain");
    if (text && isLongPaste(text)) {
      e.preventDefault();
      this.addPastedText(text);
    }
  };

  private onDragOver = (e: DragEvent) => {
    if (!this.attachments || !e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    this.toggleAttribute("data-dragging", true);
  };

  private onDragLeave = (e: DragEvent) => {
    if (e.relatedTarget instanceof Node && this.contains(e.relatedTarget)) return;
    this.toggleAttribute("data-dragging", false);
  };

  private onDrop = (e: DragEvent) => {
    if (!this.attachments || !e.dataTransfer?.files.length) return;
    e.preventDefault();
    this.toggleAttribute("data-dragging", false);
    void this.addFiles([...e.dataTransfer.files]).then(() => this.focusInput());
  };

  private onStop = () => {
    this.session?.stop();
    this.focusInput();
  };

  /** Comme si l'utilisateur avait tapé « Continue » puis envoyé (le brouillon en cours n'est pas touché). */
  private onContinue = () => {
    const text = this.continueText.trim();
    if (!text || !this.session || this.session.running) return;
    this.pinned = true;
    void this.session.send(text);
    this.focusInput();
  };

  /** Le bouton cliqué change de nature (Envoyer / Arrêter) : le focus repart dans la saisie, pas dans le vide. */
  private focusInput() {
    void this.updateComplete.then(() => this.querySelector("textarea")?.focus());
  }
}

/** JSON lisible (arguments, résultat JSON) ; texte tel quel sinon. */
function pretty(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function clip(text: string): string {
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}\n… (${text.length - MAX_DETAIL} caractères de plus)` : text;
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
