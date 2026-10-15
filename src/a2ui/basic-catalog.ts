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

/**
 * Concorde extension props. The A2UI basic catalog only knows a handful of
 * props per component; these optional extras (same names as the Concorde
 * attributes) expose what Concorde offers on top. They are never required, and
 * every value goes through an allow-list: `profile="safe"` does not filter
 * attributes, so this is what keeps agent strings out of arbitrary attributes.
 */
const SIZES = ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"] as const;
const BUTTON_TYPES = ["primary", "neutral", "warning", "danger", "success", "info"] as const;
const BUTTON_VARIANTS = ["outline", "ghost", "link"] as const;
const BUTTON_SHAPES = ["circle", "square", "block"] as const;
const FIELD_STATUSES = ["success", "error", "warning", "info"] as const;
const JUSTIFY_CSS: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  spaceBetween: "space-between",
  spaceAround: "space-around",
  spaceEvenly: "space-evenly",
  stretch: "stretch",
};
const ALIGN_CSS: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };

/** Optional literal prop restricted to a list; any other value is dropped with a warning. */
function oneOf(c: A2uiComponent, prop: string, allowed: readonly string[], ctx: MapContext): string | undefined {
  const v = literal(c, prop);
  if (v == null) return undefined;
  if (allowed.includes(v)) return v;
  ctx.warn(`${c.component} "${c.id}": ${prop}="${v}" is not supported (expected ${allowed.join(", ")}); ignored`);
  return undefined;
}

/** Optional boolean literal (`true` → presence attribute). */
function flag(c: A2uiComponent, prop: string): boolean {
  return literal(c, prop) === "true";
}

/** label / description (escaped) and disabled, shared by every form control. */
function textAttributes(c: A2uiComponent): Record<string, string> {
  const attributes: Record<string, string> = {};
  const label = labelText(c, "label");
  if (label) attributes.label = label;
  const description = labelText(c, "description");
  if (description) attributes.description = description;
  if (flag(c, "disabled")) attributes.disabled = "";
  return attributes;
}

/** Attributes shared by text-like inputs (`sonic-input`, `sonic-textarea`). */
function inputAttributes(c: A2uiComponent, ctx: MapContext): Record<string, string> {
  const attributes = textAttributes(c);
  const size = oneOf(c, "size", SIZES, ctx);
  if (size) attributes.size = size;
  const status = oneOf(c, "status", FIELD_STATUSES, ctx);
  if (status) attributes.status = status;
  if (flag(c, "required")) attributes.required = "";
  if (flag(c, "readonly")) attributes.readonly = "";
  const placeholder = literal(c, "placeholder"); // set as a property by Lit, never parsed as HTML
  if (placeholder) attributes.placeholder = placeholder;
  return attributes;
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
  Row: (c, ctx) => {
    const layout = oneOf(c, "layout", ["actions", "group"], ctx);
    if (layout === "actions") {
      // sonic-form-actions: footer row for submit / cancel (justify and align are CSS values there).
      const attributes: Record<string, string> = {};
      const justify = literal(c, "justify");
      const align = literal(c, "align");
      if (justify && JUSTIFY_CSS[justify]) attributes.justify = JUSTIFY_CSS[justify];
      if (align && ALIGN_CSS[align]) attributes.alignItems = ALIGN_CSS[align];
      return { key: "a2ui:Row.actions", attributes };
    }
    if (layout === "group") {
      // sonic-group: one row of controls sharing a radius, with optional label and description.
      const attributes: Record<string, string> = {};
      const label = labelText(c, "label");
      if (label) attributes.label = label;
      const description = labelText(c, "description");
      if (description) attributes.description = description;
      const align = literal(c, "align");
      if (align && ALIGN_CSS[align]) attributes.alignItems = ALIGN_CSS[align];
      return { key: "a2ui:Row.group", attributes };
    }
    return { key: "a2ui:Row", attributes: flexAttributes(c) };
  },
  Column: (c, ctx) => {
    // sonic-form-layout: responsive two-column grid for form controls.
    if (oneOf(c, "layout", ["form"], ctx) === "form") return { key: "a2ui:Column.form" };
    return { key: "a2ui:Column", attributes: flexAttributes(c) };
  },
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

  Button: (c, ctx) => {
    // `variant` takes the A2UI values (primary, borderless) and the Concorde ones (outline, ghost, link).
    const variant = literal(c, "variant");
    const key = variant === "primary" || variant === "borderless" ? `a2ui:Button.${variant}` : "a2ui:Button";
    const attributes: Record<string, string> = {};
    if (variant && (BUTTON_VARIANTS as readonly string[]).includes(variant)) attributes.variant = variant;
    else if (variant && !["default", "primary", "borderless"].includes(variant)) {
      ctx.warn(`Button "${c.id}": variant="${variant}" is not supported; ignored`);
    }
    // An explicit `type` (colour) wins over the one implied by variant "primary".
    const type = oneOf(c, "type", BUTTON_TYPES, ctx);
    if (type) attributes.type = type;
    const size = oneOf(c, "size", SIZES, ctx);
    if (size) attributes.size = size;
    const shape = oneOf(c, "shape", BUTTON_SHAPES, ctx);
    if (shape) attributes.shape = shape;
    if (flag(c, "loading")) attributes.loading = "";
    if (flag(c, "disabled")) attributes.disabled = "";
    // Selected / toggled-on look.
    if (flag(c, "active")) attributes.active = "";
    return { key, attributes };
  },

  TextField: (c, ctx) => {
    const attributes = inputAttributes(c, ctx);
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
      ...textAttributes(c),
    };
    // `variant: "switch"` renders the same boolean as a sonic-switch.
    const tagName = oneOf(c, "variant", ["checkbox", "switch"], ctx) === "switch" ? "sonic-switch" : "sonic-checkbox";
    return {
      key: "a2ui:CheckBox",
      nodes: [bridge(ctx, c, boundPath(c, "value"), "bool"), { tagName, attributes }],
    };
  },

  ChoicePicker: (c, ctx) => {
    const key = boundPath(c, "value");
    const multiple = literal(c, "variant") === "multipleSelection";
    // Chips are real toggle buttons (sonic-button is checkable, like checkbox and radio).
    const chips = literal(c, "displayStyle") === "chips";
    if (c.filterable === true) ctx.warn(`ChoicePicker "${c.id}": filterable is ignored`);
    const options = Array.isArray(c.options) ? (c.options as { label?: unknown; value?: unknown }[]) : [];
    const disabled = flag(c, "disabled");
    const size = oneOf(c, "size", SIZES, ctx);
    const field = multiple
      ? { formDataProvider: ctx.dataProvider, name: key }
      : { formDataProvider: fieldProvider(ctx, c.id), name: "v" };
    const choices: SDUINode[] = [];
    if (!multiple) choices.push(bridge(ctx, c, key, "list1"));
    for (const [i, opt] of options.entries()) {
      if (typeof opt?.value !== "string") {
        throw new A2uiUnsupportedError(`ChoicePicker.options[${i}].value: a string is required`, c.id);
      }
      if (typeof opt.label !== "string") {
        throw new A2uiUnsupportedError(`ChoicePicker.options[${i}].label: bindings are not supported yet`, c.id);
      }
      const attributes: Record<string, string> = { value: opt.value, ...field };
      if (disabled) attributes.disabled = "";
      if (chips) {
        attributes.variant = "outline";
        if (!multiple) attributes.radio = "";
        if (size) attributes.size = size;
        choices.push({ tagName: "sonic-button", attributes, textContent: opt.label });
      } else {
        attributes.label = escapeHtml(opt.label);
        choices.push({ tagName: multiple ? "sonic-checkbox" : "sonic-radio", attributes });
      }
    }
    // The fieldset carries the label, the description and the native group semantics.
    const attributes: Record<string, string> = {};
    const label = labelText(c, "label");
    if (label) attributes.label = label;
    const description = labelText(c, "description");
    if (description) attributes.description = description;
    if (disabled) attributes.disabled = "";
    return {
      key: "a2ui:ChoicePicker",
      attributes,
      nodes: [{ tagName: "div", attributes: { "data-a2ui-choices": chips ? "chips" : "list" }, nodes: choices }],
    };
  },

  Slider: (c, ctx) => {
    const attributes: Record<string, string> = {
      type: "range",
      name: "v",
      formDataProvider: fieldProvider(ctx, c.id),
      min: literal(c, "min") ?? "0",
      ...inputAttributes(c, ctx),
    };
    const max = literal(c, "max");
    if (max) attributes.max = max;
    return {
      key: "a2ui:Slider",
      nodes: [bridge(ctx, c, boundPath(c, "value"), "number"), { tagName: "sonic-input", attributes }],
    };
  },

  DateTimeInput: (c, ctx) => {
    const date = c.enableDate === true;
    const time = c.enableTime === true;
    const attributes: Record<string, string> = {
      formDataProvider: ctx.dataProvider,
      name: boundPath(c, "value"),
      ...inputAttributes(c, ctx),
    };
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
