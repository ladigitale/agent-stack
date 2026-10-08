import type { SDUINode } from "@supersoniks/concorde/core/components/functional/sdui/types";
import { a2uiBasicLibrary } from "../libraries";
import { pointerToKey } from "./pointer";
import type { A2uiComponent, A2uiDynamic, A2uiPathBinding } from "./types";

/**
 * Mapping of the A2UI v0.9 basic catalog to Concorde.
 *
 * The structure of each component lives in the `a2ui-basic` SDUI library
 * (JSON); this file only translates A2UI props into attributes and children.
 * Library entries are expanded inline (not referenced by `libraryKey`), so the
 * incremental ops never depend on a library being loaded in `sonic-sdui`.
 *
 * Output never contains `markup`, `innerHTML`, `prefix`, `suffix` or `js`:
 * it always passes `profile="safe"`.
 */

export class A2uiUnsupportedError extends Error {
  constructor(message: string, readonly componentId: string) {
    super(message);
    this.name = "A2uiUnsupportedError";
  }
}

export type MapContext = {
  /** Concorde data provider holding this surface's data model. */
  dataProvider: string;
  /** Non-fatal notice (feature ignored, approximated…). */
  warn: (message: string) => void;
  /** Library to expand. Defaults to `a2ui-basic`. */
  library?: Record<string, SDUINode>;
};

type Mapped = {
  key: string;
  attributes?: Record<string, string>;
  nodes?: SDUINode[];
  textContent?: string;
};
type Mapper = (c: A2uiComponent, ctx: MapContext) => Mapped;

const isPath = (v: unknown): v is A2uiPathBinding =>
  typeof v === "object" && v !== null && typeof (v as A2uiPathBinding).path === "string";
const isCall = (v: unknown) => typeof v === "object" && v !== null && "call" in v;

/** Resolves a prop that must be a literal (bindings on attributes are not supported yet). */
function literal(c: A2uiComponent, prop: string): string | undefined {
  const v = c[prop];
  if (v == null) return undefined;
  if (isPath(v) || isCall(v)) {
    throw new A2uiUnsupportedError(
      `${c.component}.${prop}: data bindings and function calls are not supported on this prop yet`,
      c.id
    );
  }
  return String(v);
}

/** Literal → textContent ; path → <a2ui-text> bound to the data model (plain text). */
function text(c: A2uiComponent, prop: string, ctx: MapContext): Pick<Mapped, "nodes" | "textContent"> {
  const v = c[prop] as A2uiDynamic | undefined;
  if (isPath(v)) {
    return {
      nodes: [
        {
          tagName: "a2ui-text",
          attributes: { "data-provider": ctx.dataProvider, key: pointerToKey(v.path) },
        },
      ],
    };
  }
  if (isCall(v)) {
    throw new A2uiUnsupportedError(`${c.component}.${prop}: function calls are not supported yet`, c.id);
  }
  return { textContent: v == null ? "" : String(v) };
}

function flexAttributes(c: A2uiComponent): Record<string, string> {
  const attributes: Record<string, string> = {};
  const justify = literal(c, "justify");
  const align = literal(c, "align");
  if (justify) attributes["data-a2ui-justify"] = justify;
  if (align) attributes["data-a2ui-align"] = align;
  return attributes;
}

/**
 * Concorde form components render `label` / `description` with `unsafeHTML`:
 * agent strings are escaped so they always display as text.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Literal text prop meant for a Concorde `label`-like attribute (escaped). */
function labelText(c: A2uiComponent, prop: string): string | undefined {
  const v = literal(c, prop);
  return v == null ? undefined : escapeHtml(v);
}

/** Scratch data provider of a bridged field (Concorde field ⇄ A2UI value). */
function fieldProvider(ctx: MapContext, componentId: string): string {
  return `${ctx.dataProvider}__${componentId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function boundPath(c: A2uiComponent, prop: string): string {
  const v = c[prop];
  if (!isPath(v)) {
    throw new A2uiUnsupportedError(`${c.component}.${prop}: a data binding ({"path": …}) is required`, c.id);
  }
  return pointerToKey(v.path);
}

function bridge(ctx: MapContext, c: A2uiComponent, key: string, codec: "bool" | "list1" | "number"): SDUINode {
  return {
    tagName: "a2ui-bridge",
    attributes: { "data-provider": ctx.dataProvider, key, "field-provider": fieldProvider(ctx, c.id), codec },
  };
}

const TEXT_VARIANTS = new Set(["h1", "h2", "h3", "h4", "h5", "caption"]);

const mappers: Record<string, Mapper> = {
  Row: (c) => ({ key: "a2ui:Row", attributes: flexAttributes(c) }),
  Column: (c) => ({ key: "a2ui:Column", attributes: flexAttributes(c) }),
  List: (c) => {
    const attributes = flexAttributes(c);
    if (literal(c, "direction") === "horizontal") attributes["data-a2ui-direction"] = "horizontal";
    return { key: "a2ui:List", attributes };
  },

  Text: (c, ctx) => {
    const variant = literal(c, "variant");
    if (typeof c.text === "string" && /[*_`#[]/.test(c.text)) {
      ctx.warn(`Text "${c.id}": Markdown is rendered as plain text`);
    }
    const key = variant && TEXT_VARIANTS.has(variant) ? `a2ui:Text.${variant}` : "a2ui:Text";
    return { key, ...text(c, "text", ctx) };
  },

  Card: () => ({ key: "a2ui:Card" }),

  Divider: (c) => ({
    key: "a2ui:Divider",
    attributes: literal(c, "axis") === "vertical" ? { vertical: "" } : undefined,
  }),

  Icon: (c) => ({ key: "a2ui:Icon", attributes: { name: literal(c, "name") ?? "" } }),

  Image: (c) => {
    const attributes: Record<string, string> = {};
    const url = literal(c, "url");
    if (url) attributes.src = url;
    if (literal(c, "fit") === "cover") attributes.cover = "";
    return { key: "a2ui:Image", attributes };
  },

  Button: (c) => {
    const variant = literal(c, "variant");
    return { key: variant === "primary" || variant === "borderless" ? `a2ui:Button.${variant}` : "a2ui:Button" };
  },

  TextField: (c, ctx) => {
    const attributes: Record<string, string> = {};
    const label = labelText(c, "label");
    if (label) attributes.label = label;
    const variant = literal(c, "variant");
    const key =
      variant === "longText" || variant === "number" || variant === "obscured"
        ? `a2ui:TextField.${variant}`
        : "a2ui:TextField";

    const value = c.value as A2uiDynamic | undefined;
    if (isPath(value)) {
      attributes.formDataProvider = ctx.dataProvider;
      attributes.name = pointerToKey(value.path);
    } else if (value != null) {
      if (isCall(value)) throw new A2uiUnsupportedError("TextField.value: function calls are not supported", c.id);
      attributes.value = String(value);
      ctx.warn(`TextField "${c.id}": literal value is not written back to the data model`);
    }
    return { key, attributes };
  },

  CheckBox: (c, ctx) => {
    const attributes: Record<string, string> = {
      unique: "",
      value: "true",
      name: "v",
      formDataProvider: fieldProvider(ctx, c.id),
    };
    const label = labelText(c, "label");
    if (label) attributes.label = label;
    return {
      key: "a2ui:CheckBox",
      nodes: [bridge(ctx, c, boundPath(c, "value"), "bool"), { tagName: "sonic-checkbox", attributes }],
    };
  },

  ChoicePicker: (c, ctx) => {
    const key = boundPath(c, "value");
    const multiple = literal(c, "variant") === "multipleSelection";
    if (literal(c, "displayStyle") === "chips") ctx.warn(`ChoicePicker "${c.id}": chips are rendered as ${multiple ? "checkboxes" : "radios"}`);
    if (c.filterable === true) ctx.warn(`ChoicePicker "${c.id}": filterable is ignored`);
    const options = Array.isArray(c.options) ? (c.options as { label?: unknown; value?: unknown }[]) : [];
    const nodes: SDUINode[] = [];
    const label = literal(c, "label");
    if (label) nodes.push({ tagName: "p", attributes: { "data-a2ui-label": "" }, textContent: label });
    if (!multiple) nodes.push(bridge(ctx, c, key, "list1"));
    for (const [i, opt] of options.entries()) {
      if (typeof opt?.value !== "string") {
        throw new A2uiUnsupportedError(`ChoicePicker.options[${i}].value: a string is required`, c.id);
      }
      if (typeof opt.label !== "string") {
        throw new A2uiUnsupportedError(`ChoicePicker.options[${i}].label: bindings are not supported yet`, c.id);
      }
      nodes.push({
        tagName: multiple ? "sonic-checkbox" : "sonic-radio",
        attributes: {
          value: opt.value,
          label: escapeHtml(opt.label),
          ...(multiple ? { formDataProvider: ctx.dataProvider, name: key } : { formDataProvider: fieldProvider(ctx, c.id), name: "v" }),
        },
      });
    }
    return { key: "a2ui:ChoicePicker", nodes };
  },

  Slider: (c, ctx) => {
    const attributes: Record<string, string> = {
      type: "range",
      name: "v",
      formDataProvider: fieldProvider(ctx, c.id),
      min: literal(c, "min") ?? "0",
    };
    const max = literal(c, "max");
    if (max) attributes.max = max;
    const label = labelText(c, "label");
    if (label) attributes.label = label;
    return {
      key: "a2ui:Slider",
      nodes: [bridge(ctx, c, boundPath(c, "value"), "number"), { tagName: "sonic-input", attributes }],
    };
  },

  DateTimeInput: (c, ctx) => {
    const date = c.enableDate === true;
    const time = c.enableTime === true;
    const attributes: Record<string, string> = { formDataProvider: ctx.dataProvider, name: boundPath(c, "value") };
    const label = labelText(c, "label");
    if (label) attributes.label = label;
    for (const bound of ["min", "max"]) {
      const v = literal(c, bound);
      if (v) attributes[bound] = v;
    }
    return { key: date && !time ? "a2ui:DateTimeInput.date" : time && !date ? "a2ui:DateTimeInput.time" : "a2ui:DateTimeInput", attributes };
  },

  Tabs: (c) => {
    const tabs = Array.isArray(c.tabs) ? (c.tabs as { title?: unknown }[]) : [];
    const titles = tabs.map((t, i) => {
      if (typeof t?.title !== "string") throw new A2uiUnsupportedError(`Tabs.tabs[${i}].title: bindings are not supported yet`, c.id);
      return t.title;
    });
    return { key: "a2ui:Tabs", attributes: { titles: JSON.stringify(titles) } };
  },

  Modal: () => ({ key: "a2ui:Modal" }),
};

/** Components of the basic catalog not mapped yet. */
export const UNSUPPORTED_COMPONENTS = ["Video", "AudioPlayer"] as const;

export const SUPPORTED_COMPONENTS = Object.keys(mappers);

/** Expands a library entry and applies the mapped props on top of it. */
function expand(mapped: Mapped, library: Record<string, SDUINode>, componentId: string): SDUINode {
  const entry = library[mapped.key];
  if (!entry) throw new A2uiUnsupportedError(`Library entry "${mapped.key}" is missing`, componentId);
  const node: SDUINode = structuredClone(entry);
  if (mapped.attributes && Object.keys(mapped.attributes).length) {
    node.attributes = { ...node.attributes, ...mapped.attributes };
  }
  if (mapped.nodes) node.nodes = [...(node.nodes ?? []), ...mapped.nodes];
  if (mapped.textContent != null) node.textContent = mapped.textContent;
  return node;
}

export function mapComponent(c: A2uiComponent, ctx: MapContext): SDUINode {
  const mapper = mappers[c.component];
  if (!mapper) {
    throw new A2uiUnsupportedError(`Component "${c.component}" is not supported`, c.id);
  }
  if (c.checks?.length) ctx.warn(`${c.component} "${c.id}": checks are ignored (not supported yet)`);
  const node = expand(mapper(c, ctx), ctx.library ?? a2uiBasicLibrary, c.id);
  if (typeof c.weight === "number") {
    node.attributes = { ...node.attributes, style: `flex-grow:${c.weight}` };
  }
  return node;
}

/** Child ids referenced by a component, in order. */
export function childIdsOf(c: A2uiComponent): string[] {
  if (Array.isArray(c.children)) return c.children;
  if (typeof c.child === "string") return [c.child];
  if (c.component === "Tabs" && Array.isArray(c.tabs)) {
    return (c.tabs as { child?: unknown }[]).map((t) => t?.child).filter((x): x is string => typeof x === "string");
  }
  if (c.component === "Modal") {
    return [c.trigger, c.content].filter((x): x is string => typeof x === "string");
  }
  return [];
}
