/**
 * A2UI v0.9 message types (subset used by the adapter).
 * Source of truth: https://a2ui.org/specification/v0.9-a2ui/
 */

export const A2UI_VERSION = "v0.9" as const;
export const A2UI_BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";

/** `{"path": "/a/b"}` — absolute (leading `/`) or relative to a template item. */
export type A2uiPathBinding = { path: string };
/** `{"call": "fn", "args": {...}}` — client-side function call. */
export type A2uiFunctionCall = {
  call: string;
  args?: Record<string, unknown>;
  returnType?: string;
};
export type A2uiLiteral = string | number | boolean;
export type A2uiDynamic<T extends A2uiLiteral = A2uiLiteral> = T | A2uiPathBinding | A2uiFunctionCall;

export type A2uiTemplateChildren = { path: string; componentId: string };

export type A2uiAction =
  | { event: { name: string; context?: Record<string, unknown> } }
  | { functionCall: A2uiFunctionCall };

/**
 * A component as sent in `updateComponents`. Props sit at the top level,
 * next to `id` and `component`.
 */
export type A2uiComponent = {
  id: string;
  component: string;
  children?: string[] | A2uiTemplateChildren;
  child?: string;
  weight?: number;
  action?: A2uiAction;
  checks?: unknown[];
  [prop: string]: unknown;
};

export type A2uiCreateSurface = {
  surfaceId: string;
  catalogId: string;
  theme?: Record<string, unknown>;
  sendDataModel?: boolean;
};
export type A2uiUpdateComponents = { surfaceId: string; components: A2uiComponent[] };
export type A2uiUpdateDataModel = { surfaceId: string; path?: string; value?: unknown };
export type A2uiDeleteSurface = { surfaceId: string };

/** Server → client message. Exactly one payload key besides `version`. */
export type A2uiServerMessage = { version: typeof A2UI_VERSION } & (
  | { createSurface: A2uiCreateSurface }
  | { updateComponents: A2uiUpdateComponents }
  | { updateDataModel: A2uiUpdateDataModel }
  | { deleteSurface: A2uiDeleteSurface }
);

export type A2uiClientAction = {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
};
export type A2uiClientError = {
  code: string;
  surfaceId: string;
  message: string;
  path?: string;
};

/** Client → server message. */
export type A2uiClientMessage = { version: typeof A2UI_VERSION } & (
  | { action: A2uiClientAction }
  | { error: A2uiClientError }
);
