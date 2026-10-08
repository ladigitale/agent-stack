import type { SDUINode } from "@supersoniks/concorde/core/components/functional/sdui/types";
import { pointerToKey } from "./pointer";
import type { A2uiComponent, A2uiDynamic, A2uiPathBinding } from "./types";

/**
 * Mapping of the A2UI v0.9 basic catalog to Concorde components.
 *
 * Every mapper returns a plain SDUI node: no `markup`, `innerHTML`, `prefix`,
 * `suffix` or `js`, so the output always passes `profile="safe"`.
 * The adapter adds `nodeId` and `childNodeIds` afterwards.
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
};

type Mapper = (c: A2uiComponent, ctx: MapContext) => SDUINode;

const isPath = (v: unknown): v is A2uiPathBinding =>
  typeof v === "object" && v !== null && typeof (v as A2uiPathBinding).path === "string";
const isCall = (v: unknown) => typeof v === "object" && v !== null && "call" in v;

/** Resolves a prop that must be a literal (no binding support yet on attributes). */
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

/** Text content: literal → textContent, path → <a2ui-text> bound to the data model. */
function textNode(c: A2uiComponent, prop: string, ctx: MapContext, tagName: string): SDUINode {
  const v = c[prop] as A2uiDynamic | undefined;
  if (isPath(v)) {
    return {
      tagName,
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
  return { tagName, textContent: v == null ? "" : String(v) };
}

const JUSTIFY: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  spaceBetween: "space-between",
  spaceAround: "space-around",
  spaceEvenly: "space-evenly",
  stretch: "stretch",
};
const ALIGN: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};

function flex(direction: "row" | "column"): Mapper {
  return (c) => {
    const style = [`display:flex`, `flex-direction:${direction}`, `gap:var(--sc-gap, 0.75rem)`];
    const justify = literal(c, "justify");
    const align = literal(c, "align");
    if (justify && JUSTIFY[justify]) style.push(`justify-content:${JUSTIFY[justify]}`);
    if (align && ALIGN[align]) style.push(`align-items:${ALIGN[align]}`);
    return { tagName: "div", attributes: { style: style.join(";") } };
  };
}

const TEXT_TAGS: Record<string, string> = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  caption: "small",
  body: "p",
};

const mappers: Record<string, Mapper> = {
  Row: flex("row"),
  Column: flex("column"),
  List: (c, ctx) => {
    if (c.children && !Array.isArray(c.children)) {
      throw new A2uiUnsupportedError("List: template children are not supported yet", c.id);
    }
    return flex(literal(c, "direction") === "horizontal" ? "row" : "column")(c, ctx);
  },

  Text: (c, ctx) => {
    const variant = literal(c, "variant") ?? "body";
    if (typeof c.text === "string" && /[*_`#[]/.test(c.text)) {
      ctx.warn(`Text "${c.id}": Markdown is rendered as plain text`);
    }
    return textNode(c, "text", ctx, TEXT_TAGS[variant] ?? "p");
  },

  Card: () => ({ tagName: "sonic-card" }),

  Divider: (c) => {
    const attributes: Record<string, string> = {};
    if (literal(c, "axis") === "vertical") attributes.vertical = "";
    return { tagName: "sonic-divider", attributes };
  },

  Icon: (c) => ({ tagName: "sonic-icon", attributes: { name: literal(c, "name") ?? "" } }),

  Image: (c) => {
    const attributes: Record<string, string> = {};
    const url = literal(c, "url");
    if (url) attributes.src = url;
    const fit = literal(c, "fit");
    if (fit === "cover") attributes.cover = "";
    return { tagName: "sonic-image", attributes };
  },

  Button: (c) => {
    const attributes: Record<string, string> = {};
    const variant = literal(c, "variant");
    if (variant === "borderless") attributes.variant = "ghost";
    return { tagName: "sonic-button", attributes };
  },

  TextField: (c, ctx) => {
    const attributes: Record<string, string> = {};
    const label = literal(c, "label");
    if (label) attributes.label = label;
    const variant = literal(c, "variant") ?? "shortText";
    let tagName = "sonic-input";
    if (variant === "longText") tagName = "sonic-textarea";
    else if (variant === "number") attributes.type = "number";
    else if (variant === "obscured") attributes.type = "password";

    const value = c.value as A2uiDynamic | undefined;
    if (isPath(value)) {
      attributes.formDataProvider = ctx.dataProvider;
      attributes.name = pointerToKey(value.path);
    } else if (value != null) {
      if (isCall(value)) throw new A2uiUnsupportedError("TextField.value: function calls are not supported", c.id);
      attributes.value = String(value);
      ctx.warn(`TextField "${c.id}": literal value is not written back to the data model`);
    }
    return { tagName, attributes };
  },
};

/** Components of the basic catalog not mapped yet. */
export const UNSUPPORTED_COMPONENTS = [
  "CheckBox",
  "ChoicePicker",
  "DateTimeInput",
  "Slider",
  "Tabs",
  "Modal",
  "Video",
  "AudioPlayer",
] as const;

export const SUPPORTED_COMPONENTS = Object.keys(mappers);

export function mapComponent(c: A2uiComponent, ctx: MapContext): SDUINode {
  const mapper = mappers[c.component];
  if (!mapper) {
    throw new A2uiUnsupportedError(`Component "${c.component}" is not supported`, c.id);
  }
  if (c.checks?.length) ctx.warn(`${c.component} "${c.id}": checks are ignored (not supported yet)`);
  const node = mapper(c, ctx);
  if (typeof c.weight === "number") {
    const style = node.attributes?.style ? `${node.attributes.style};` : "";
    node.attributes = { ...node.attributes, style: `${style}flex-grow:${c.weight}` };
  }
  return node;
}

/** Child ids referenced by a component, in order. */
export function childIdsOf(c: A2uiComponent): string[] {
  if (Array.isArray(c.children)) return c.children;
  if (typeof c.child === "string") return [c.child];
  return [];
}
