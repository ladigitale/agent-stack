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
button { font: inherit; color: inherit; background: none; border: 0; border-bottom: 2px solid transparent; padding: 0.4rem 0.75rem; cursor: pointer; }
button[aria-selected=true] { border-bottom-color: var(--sc-primary, currentColor); font-weight: 600; }
button:focus-visible { outline: 2px solid var(--sc-primary, currentColor); outline-offset: 2px; }
`;

/** `<a2ui-tabs titles='["A","B"]'>` — one child per tab, in order. */
export class A2uiTabs extends SlottedChildren {
  static get observedAttributes() {
    return ["titles"];
  }
  private selected = 0;
  private bar?: HTMLElement;
  private panel?: HTMLSlotElement;

  protected build(root: ShadowRoot) {
    const style = document.createElement("style");
    style.textContent = tabsCss;
    this.bar = document.createElement("div");
    this.bar.setAttribute("role", "tablist");
    const panel = document.createElement("div");
    panel.setAttribute("role", "tabpanel");
    this.panel = document.createElement("slot");
    panel.appendChild(this.panel);
    root.append(style, this.bar, panel);
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

  private renderBar() {
    if (!this.bar || !this.panel) return;
    const titles = this.titles();
    if (this.selected >= titles.length) this.selected = 0;
    this.bar.replaceChildren(
      ...titles.map((title, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(i === this.selected));
        b.textContent = title; // plain text, never HTML
        b.addEventListener("click", () => {
          this.selected = i;
          this.renderBar();
        });
        return b;
      })
    );
    this.panel.name = this.slotFor(this.selected);
  }
}

const modalCss = `
dialog { border: 0; border-radius: var(--sc-rounded, 0.75rem); padding: 1.25rem; max-width: min(36rem, 90vw); color: inherit; background: var(--sc-base, #fff); box-shadow: 0 10px 40px rgb(0 0 0 / 0.25); }
dialog::backdrop { background: rgb(0 0 0 / 0.4); }
.close { position: absolute; top: 0.4rem; right: 0.5rem; font: inherit; font-size: 1.25rem; line-height: 1; background: none; border: 0; cursor: pointer; color: inherit; }
`;

/** `<a2ui-modal>` — first child opens the dialog, second child is its content. */
export class A2uiModal extends SlottedChildren {
  private dialog?: HTMLDialogElement;

  protected build(root: ShadowRoot) {
    const style = document.createElement("style");
    style.textContent = modalCss;
    const trigger = document.createElement("slot");
    trigger.name = "trigger";
    trigger.addEventListener("click", () => this.dialog?.showModal());
    this.dialog = document.createElement("dialog");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "close";
    close.setAttribute("aria-label", "Fermer");
    close.textContent = "×";
    close.addEventListener("click", () => this.dialog?.close());
    const content = document.createElement("slot");
    content.name = "content";
    this.dialog.append(close, content);
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
