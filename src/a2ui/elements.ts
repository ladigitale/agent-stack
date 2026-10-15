import { Objects, PublisherManager } from "@supersoniks/concorde/utils";

/**
 * `<a2ui-text data-provider="…" key="a.b">` — renders a data-model value as
 * plain text (never parsed as HTML).
 *
 * Exists because `sonic-value` renders its value with `unsafeHTML`, so any
 * agent-controlled string would be injected as markup even under
 * `profile="safe"` (see docs/concorde-gaps.md).
 */
export class A2uiText extends HTMLElement {
  private unsubscribe?: () => void;

  static get observedAttributes() {
    return ["data-provider", "key"];
  }

  connectedCallback() {
    this.bind();
  }

  disconnectedCallback() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  attributeChangedCallback() {
    if (this.isConnected) this.bind();
  }

  private bind() {
    this.unsubscribe?.();
    const provider = this.getAttribute("data-provider");
    if (!provider) return;
    const key = this.getAttribute("key") ?? "";
    let publisher = PublisherManager.get(provider);
    if (key) publisher = Objects.traverse(publisher, key.split("."));
    const handler = (value: unknown) => {
      this.textContent = toA2uiString(value);
    };
    publisher.onAssign(handler);
    this.unsubscribe = () => publisher.offAssign(handler);
    handler(publisher.get());
  }
}

/** A2UI string conversion rules (v0.9). */
export function toA2uiString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    // Concorde publishers may hand back their proxied value.
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}


type Codec = { encode: (real: unknown) => unknown; decode: (field: unknown) => unknown };

/** Conversions between the A2UI data model and what a Concorde form field writes. */
const CODECS: Record<string, Codec> = {
  /** CheckBox: boolean ⇄ sonic-checkbox `unique` value "true" / null. */
  bool: { encode: (v) => (v === true || v === "true" ? "true" : null), decode: (s) => s === "true" || s === true },
  /** ChoicePicker mutuallyExclusive: ["a"] ⇄ radio value "a". */
  list1: {
    encode: (v) => (Array.isArray(v) && v.length ? String(v[0]) : null),
    decode: (s) => (s == null || s === "" ? [] : [String(s)]),
  },
  /** Slider: number ⇄ input string. */
  number: {
    encode: (v) => (v == null || v === "" ? "" : String(v)),
    decode: (s) => (s == null || s === "" ? null : Number(s)),
  },
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * `<a2ui-bridge data-provider key field-provider codec>` — keeps an A2UI data
 * model value and a Concorde field's value in sync when their shapes differ
 * (boolean vs "true", string list vs single radio value, number vs string).
 * The field writes into its own scratch provider under the key "v".
 */
export class A2uiBridge extends HTMLElement {
  private off: Array<() => void> = [];

  connectedCallback() {
    this.style.display = "none";
    const provider = this.getAttribute("data-provider");
    const key = this.getAttribute("key");
    const fieldProvider = this.getAttribute("field-provider");
    const codec = CODECS[this.getAttribute("codec") ?? ""];
    if (!provider || !key || !fieldProvider || !codec) return;
    const real = Objects.traverse(PublisherManager.get(provider), key.split("."));
    const field = Objects.traverse(PublisherManager.get(fieldProvider), ["v"]);
    const toField = (v: unknown) => {
      const encoded = codec.encode(v);
      if (!same(field.get(), encoded)) field.set(encoded);
    };
    const toReal = (s: unknown) => {
      const decoded = codec.decode(s);
      if (!same(real.get(), decoded)) real.set(decoded);
    };
    real.onAssign(toField);
    field.onAssign(toReal);
    this.off.push(() => real.offAssign(toField), () => field.offAssign(toReal));
    const current = real.get();
    if (current !== undefined && current !== null) toField(current);
    else toReal(field.get());
  }

  disconnectedCallback() {
    for (const off of this.off) off();
    this.off = [];
  }
}

/**
 * Shared base for containers whose light-DOM children are managed by sonic-sdui:
 * the children keep their place (sonic-sdui replaces placeholders in place),
 * the element only assigns them to named slots of its shadow tree.
 */
abstract class SlottedChildren extends HTMLElement {
  private observer = new MutationObserver(() => this.assign());

  connectedCallback() {
    if (!this.shadowRoot) this.build(this.attachShadow({ mode: "open" }));
    this.observer.observe(this, { childList: true });
    this.assign();
  }

  disconnectedCallback() {
    this.observer.disconnect();
  }

  protected abstract build(root: ShadowRoot): void;
  protected abstract slotFor(index: number): string;

  private assign() {
    [...this.children].forEach((child, i) => {
      const slot = this.slotFor(i);
      if (child.getAttribute("slot") !== slot) child.setAttribute("slot", slot);
    });
  }
}

const tabsCss = `
:host { display: flex; flex-direction: column; gap: var(--a2ui-gap, 0.75rem); }
[role=tablist] { display: flex; flex-wrap: wrap; gap: 0.25rem; border-bottom: 1px solid var(--sc-base-300, #ddd); }
button { font: inherit; color: inherit; background: none; border: 0; border-bottom: 2px solid transparent; padding: 0.5rem 0.75rem; min-height: 2.75rem; cursor: pointer; display: inline-grid; }
/* Bold width reserved on a hidden twin so selecting a tab never shifts its siblings. */
button::after { content: attr(data-label); font-weight: 600; height: 0; visibility: hidden; overflow: hidden; user-select: none; }
button[aria-selected=true] { border-bottom-color: var(--sc-primary, currentColor); font-weight: 600; }
button:focus-visible { outline: 2px solid var(--sc-primary, currentColor); outline-offset: -2px; }
[role=tabpanel]:focus-visible { outline: 2px solid var(--sc-primary, currentColor); outline-offset: 2px; }
`;

let tabsCount = 0;

/** `<a2ui-tabs titles='["A","B"]'>` — one child per tab, in order. Arrow keys, Home and End move between tabs. */
export class A2uiTabs extends SlottedChildren {
  static get observedAttributes() {
    return ["titles"];
  }
  private selected = 0;
  private bar?: HTMLElement;
  private panel?: HTMLSlotElement;
  private panelEl?: HTMLElement;
  private uid = `a2ui-tabs-${++tabsCount}`;

  protected build(root: ShadowRoot) {
    const style = document.createElement("style");
    style.textContent = tabsCss;
    this.bar = document.createElement("div");
    this.bar.setAttribute("role", "tablist");
    this.bar.addEventListener("keydown", (e) => this.onKey(e));
    this.panelEl = document.createElement("div");
    this.panelEl.setAttribute("role", "tabpanel");
    this.panelEl.id = `${this.uid}-panel`;
    this.panelEl.tabIndex = 0;
    this.panel = document.createElement("slot");
    this.panelEl.appendChild(this.panel);
    root.append(style, this.bar, this.panelEl);
    this.renderBar();
  }

  protected slotFor(index: number) {
    return `tab-${index}`;
  }

  attributeChangedCallback() {
    this.renderBar();
  }

  private titles(): string[] {
    try {
      const t = JSON.parse(this.getAttribute("titles") ?? "[]");
      return Array.isArray(t) ? t.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  }

  private select(i: number, focus = false) {
    this.selected = i;
    this.renderBar();
    if (focus) (this.bar?.children[i] as HTMLElement | undefined)?.focus();
  }

  private onKey(e: KeyboardEvent) {
    const n = this.titles().length;
    if (!n) return;
    const rtl = getComputedStyle(this).direction === "rtl";
    let next: number | undefined;
    if (e.key === "ArrowRight") next = this.selected + (rtl ? -1 : 1);
    else if (e.key === "ArrowLeft") next = this.selected + (rtl ? 1 : -1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next === undefined) return;
    e.preventDefault();
    this.select((next + n) % n, true);
  }

  private renderBar() {
    if (!this.bar || !this.panel || !this.panelEl) return;
    const titles = this.titles();
    if (this.selected >= titles.length) this.selected = 0;
    this.bar.replaceChildren(
      ...titles.map((title, i) => {
        const on = i === this.selected;
        const b = document.createElement("button");
        b.type = "button";
        b.id = `${this.uid}-tab-${i}`;
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(on));
        b.setAttribute("aria-controls", this.panelEl!.id);
        b.tabIndex = on ? 0 : -1; // roving tabindex: one tab stop, arrows inside
        b.dataset.label = title;
        b.textContent = title; // plain text, never HTML
        b.addEventListener("click", () => this.select(i));
        return b;
      })
    );
    this.panelEl.setAttribute("aria-labelledby", `${this.uid}-tab-${this.selected}`);
    this.panel.name = this.slotFor(this.selected);
  }
}

const modalCss = `
dialog { border: 0; border-radius: var(--sc-rounded, 0.75rem); padding: 1.25rem; padding-block-start: 3rem; max-width: min(36rem, 90vw); max-height: 85vh; overflow: auto; overscroll-behavior: contain; color: inherit; background: var(--sc-base, #fff); box-shadow: 0 10px 40px rgb(0 0 0 / 0.25); }
dialog::backdrop { background: rgb(0 0 0 / 0.4); }
.close { position: absolute; top: 0.25rem; inset-inline-end: 0.25rem; display: inline-flex; align-items: center; justify-content: center; width: 2.75rem; height: 2.75rem; padding: 0; background: none; border: 0; border-radius: 50%; cursor: pointer; color: inherit; }
.close:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.close:focus-visible { outline: 2px solid var(--sc-primary, currentColor); outline-offset: -2px; }
.close svg { width: 1.25rem; height: 1.25rem; }
`;

const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

/**
 * `<a2ui-modal close-label="Fermer">` — first child opens the dialog, second child is its content.
 * Escape, the close button and a click on the backdrop all close it.
 */
export class A2uiModal extends SlottedChildren {
  static get observedAttributes() {
    return ["close-label"];
  }
  private dialog?: HTMLDialogElement;
  private closeBtn?: HTMLButtonElement;

  attributeChangedCallback() {
    this.syncLabel();
  }

  private syncLabel() {
    this.closeBtn?.setAttribute("aria-label", this.getAttribute("close-label") || "Fermer");
  }

  protected build(root: ShadowRoot) {
    const style = document.createElement("style");
    style.textContent = modalCss;
    const trigger = document.createElement("slot");
    trigger.name = "trigger";
    trigger.addEventListener("click", () => this.dialog?.showModal());
    this.dialog = document.createElement("dialog");
    this.closeBtn = document.createElement("button");
    this.closeBtn.type = "button";
    this.closeBtn.className = "close";
    this.closeBtn.innerHTML = CLOSE_ICON; // constant, authored here
    this.syncLabel();
    this.closeBtn.addEventListener("click", () => this.dialog?.close());
    // A click whose target is the <dialog> itself landed on the backdrop.
    this.dialog.addEventListener("click", (e) => {
      if (e.target === this.dialog) this.dialog?.close();
    });
    const content = document.createElement("slot");
    content.name = "content";
    this.dialog.append(this.closeBtn, content);
    root.append(style, trigger, this.dialog);
  }

  protected slotFor(index: number) {
    return index === 0 ? "trigger" : "content";
  }
}

export function defineA2uiElements() {
  const define = (name: string, ctor: CustomElementConstructor) => {
    if (!customElements.get(name)) customElements.define(name, ctor);
  };
  define("a2ui-text", A2uiText);
  define("a2ui-bridge", A2uiBridge);
  define("a2ui-tabs", A2uiTabs);
  define("a2ui-modal", A2uiModal);
}
