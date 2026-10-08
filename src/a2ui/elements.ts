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

export function defineA2uiElements() {
  if (!customElements.get("a2ui-text")) customElements.define("a2ui-text", A2uiText);
}
