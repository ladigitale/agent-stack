import type { SDUINode, SDUIOp } from "@supersoniks/concorde/core/components/functional/sdui/types";
import { A2uiUnsupportedError, childIdsOf, mapComponent } from "./basic-catalog";
import { A2uiPathError, parsePointer, pointerToPath } from "./pointer";
import type {
  A2uiAction,
  A2uiClientAction,
  A2uiClientError,
  A2uiComponent,
  A2uiTemplateChildren,
  A2uiUpdateComponents,
  A2uiUpdateDataModel,
} from "./types";

export const A2UI_ROOT_ID = "root";

export type SurfaceResult = {
  ops: SDUIOp[];
  /** Fatal problems on single components or paths, ready to send back as A2UI errors. */
  errors: A2uiClientError[];
  warnings: string[];
};

/** Concorde publisher ids cannot contain "." — derive a safe one per surface. */
export function dataProviderIdFor(surfaceId: string, prefix = "a2ui_"): string {
  return `${prefix}${surfaceId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

type Placement = { parentId?: string; index?: number };

const isTemplate = (children: A2uiComponent["children"]): children is A2uiTemplateChildren =>
  !!children && !Array.isArray(children) && typeof children === "object";

/**
 * Pure state machine for one A2UI surface: turns A2UI messages into Concorde
 * SDUI incremental ops. It does not touch the DOM.
 *
 * Ordering rule: a component is only upserted once its parent has been, so
 * Concorde never has to invent a parent (see docs/concorde-gaps.md, gap 3).
 * Components whose parent is unknown are kept until a parent references them.
 * Nothing is emitted until the `root` component exists, as the spec requires.
 *
 * Template lists (`children: {path, componentId}`) are expanded here: the
 * surface keeps a mirror of its data model, instantiates the template subtree
 * once per array item (ids `<id>@<list>/<i>`, relative paths made absolute)
 * and re-emits the list when the array length changes. Item values stay
 * reactive on their own through their bindings.
 */
export class A2uiSurface {
  readonly dataProvider: string;
  /** Components as sent by the agent. */
  private components = new Map<string, A2uiComponent>();
  /** Template instances, already resolved (absolute paths, unique ids). */
  private instances = new Map<string, A2uiComponent>();
  /** Current instance ids of each emitted template list. */
  private listItems = new Map<string, string[]>();
  private placements = new Map<string, Placement>();
  private emitted = new Set<string>();
  private model: unknown = {};

  constructor(
    readonly surfaceId: string,
    dataProvider = dataProviderIdFor(surfaceId),
    /** Renames emitted tags (e.g. `sonic-card` → `afx-card` in a prefixed Concorde build). */
    private readonly mapTag: (tag: string) => string = (t) => t
  ) {
    this.dataProvider = dataProvider;
  }

  updateComponents(msg: Pick<A2uiUpdateComponents, "components">): SurfaceResult {
    const result: SurfaceResult = { ops: [], errors: [], warnings: [] };
    for (const c of msg.components) this.components.set(c.id, c);

    const parents = this.parentIndex();
    const visited = new Set<string>();
    const inTemplates = this.templateMembers();
    const templateChanged = msg.components.some((c) => inTemplates.has(c.id));

    for (const c of msg.components) {
      if (c.id === A2UI_ROOT_ID) {
        this.visit(c.id, {}, result, visited);
        continue;
      }
      if (inTemplates.has(c.id)) continue; // rendered through its instances
      const parent = parents.get(c.id);
      if (!parent) continue; // not placed yet
      // New component, or update of an emitted one (replaced in place).
      if (this.emitted.has(parent.id)) this.visit(c.id, { parentId: parent.id, index: parent.index }, result, visited);
    }
    this.refreshLists(result, visited, templateChanged);
    return result;
  }

  updateDataModel(msg: Pick<A2uiUpdateDataModel, "path" | "value">): SurfaceResult {
    const result: SurfaceResult = { ops: [], errors: [], warnings: [] };
    const pointer = msg.path ?? "/";
    try {
      const path = pointerToPath(pointer, this.dataProvider);
      if (!("value" in msg)) {
        result.warnings.push(`updateDataModel without value at "${pointer}": key set to undefined, not deleted`);
      }
      this.model = writePointer(this.model, parsePointer(pointer), msg.value);
      result.ops.push({ op: "setData", path, value: msg.value });
      this.refreshLists(result, new Set(), false);
    } catch (e) {
      result.errors.push(this.errorFrom(e, pointer));
    }
    return result;
  }

  /** Raw A2UI action of a component or template instance, if any. */
  actionOf(componentId: string): A2uiAction | undefined {
    return this.get(componentId)?.action;
  }

  /**
   * Builds the A2UI client action from a Concorde `sdui-action`.
   * `resolve` reads a Concorde path (bindings in `context` are resolved here).
   */
  buildClientAction(
    detail: { name: string; context?: Record<string, unknown>; sourceNodeId?: string },
    resolve: (concordePath: string) => unknown,
    now = new Date()
  ): A2uiClientAction {
    const context: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(detail.context ?? {})) {
      context[k] =
        typeof v === "object" && v !== null && typeof (v as { path?: unknown }).path === "string"
          ? resolve(pointerToPath((v as { path: string }).path, this.dataProvider))
          : v;
    }
    return {
      name: detail.name,
      surfaceId: this.surfaceId,
      sourceComponentId: detail.sourceNodeId ?? "",
      timestamp: now.toISOString(),
      context,
    };
  }

  // ——— Emission ———

  private get(id: string): A2uiComponent | undefined {
    return this.components.get(id) ?? this.instances.get(id);
  }

  private visit(id: string, placement: Placement, result: SurfaceResult, visited: Set<string>) {
    const c = this.get(id);
    if (!c || visited.has(id)) return; // not arrived yet: Concorde shows a placeholder
    visited.add(id);
    const children = this.childrenOf(c, result);
    const node = this.toNode(c, children, result);
    if (!node) return;
    result.ops.push({ op: "upsertNode", node, ...(placement.parentId ? placement : {}) });
    this.emitted.add(id);
    this.placements.set(id, placement);
    // Children that arrived earlier (or in this batch) are now attachable.
    children.forEach((childId, index) => {
      if (!this.emitted.has(childId)) this.visit(childId, { parentId: id, index }, result, visited);
    });
  }

  /**
   * Re-emits template lists whose items changed. `force` rebuilds every list
   * (a template definition changed).
   */
  private refreshLists(result: SurfaceResult, visited: Set<string>, force: boolean) {
    for (const [listId, before] of [...this.listItems]) {
      if (!this.emitted.has(listId) || visited.has(listId)) continue;
      const list = this.get(listId);
      if (!list || !isTemplate(list.children)) continue;
      const after = this.itemIdsFor(list);
      if (!force && sameIds(before, after)) continue;
      // Old instances are rebuilt from the current definitions.
      for (const id of before) this.forget(id, !after.includes(id), result);
      if (force) for (const id of after) this.forget(id, false, result);
      this.visit(listId, this.placements.get(listId) ?? {}, result, visited);
    }
  }

  /** Drops an instance (and its subtree) from the emitted state; `remove` also removes it from the DOM. */
  private forget(id: string, remove: boolean, result: SurfaceResult) {
    const c = this.instances.get(id);
    if (!c) return;
    for (const child of staticChildren(c)) this.forget(child, false, result);
    for (const item of this.listItems.get(id) ?? []) this.forget(item, false, result);
    this.listItems.delete(id);
    this.emitted.delete(id);
    this.placements.delete(id);
    if (remove) result.ops.push({ op: "removeNode", nodeId: id });
  }

  private childrenOf(c: A2uiComponent, result: SurfaceResult): string[] {
    if (!isTemplate(c.children)) return staticChildren(c);
    try {
      return this.itemIdsFor(c);
    } catch (e) {
      result.errors.push(this.errorFrom(e, c.children.path));
      return [];
    }
  }

  /** Instantiates the template once per item of the bound array; returns the instance root ids. */
  private itemIdsFor(list: A2uiComponent): string[] {
    const tpl = list.children as A2uiTemplateChildren;
    if (!tpl.path.startsWith("/")) {
      throw new A2uiPathError(`List "${list.id}": relative template path outside a template`, tpl.path);
    }
    const items = readPointer(this.model, parsePointer(tpl.path));
    const ids = Array.isArray(items)
      ? items.map((_, i) => this.instantiate(tpl.componentId, `${tpl.path}/${i}`, `${list.id}/${i}`))
      : [];
    this.listItems.set(list.id, ids);
    return ids;
  }

  /** Registers a resolved copy of `defId`'s subtree for one item; returns the copy's id. */
  private instantiate(defId: string, scope: string, key: string): string {
    const id = `${defId}@${key}`;
    const def = this.components.get(defId);
    if (!def) return id; // template not arrived yet: placeholder, rebuilt when it does
    const resolved = resolvePaths(def, scope) as A2uiComponent;
    resolved.id = id;
    if (Array.isArray(def.children)) {
      resolved.children = def.children.map((child) => this.instantiate(child, scope, key));
    } else if (isTemplate(def.children)) {
      const path = def.children.path.startsWith("/") ? def.children.path : `${scope}/${def.children.path}`;
      resolved.children = { path, componentId: def.children.componentId };
    }
    if (typeof def.child === "string") resolved.child = this.instantiate(def.child, scope, key);
    if (def.component === "Tabs" && Array.isArray(def.tabs)) {
      resolved.tabs = (def.tabs as { child?: unknown }[]).map((t) =>
        typeof t?.child === "string" ? { ...t, child: this.instantiate(t.child, scope, key) } : t
      );
    }
    if (def.component === "Modal") {
      if (typeof def.trigger === "string") resolved.trigger = this.instantiate(def.trigger, scope, key);
      if (typeof def.content === "string") resolved.content = this.instantiate(def.content, scope, key);
    }
    this.instances.set(id, resolved);
    return id;
  }

  private toNode(c: A2uiComponent, children: string[], result: SurfaceResult): SDUINode | null {
    try {
      const node = renameTags(
        mapComponent(c, {
          dataProvider: this.dataProvider,
          warn: (m) => result.warnings.push(m),
        }),
        this.mapTag
      );
      node.nodeId = c.id;
      if (children.length || isTemplate(c.children)) node.childNodeIds = [...children];
      if (c.action) {
        if ("event" in c.action) {
          node.action = { name: c.action.event.name, context: c.action.event.context ?? {} };
        } else {
          result.warnings.push(`${c.component} "${c.id}": local function-call actions are ignored`);
        }
      }
      return node;
    } catch (e) {
      result.errors.push(this.errorFrom(e));
      return null;
    }
  }

  private errorFrom(e: unknown, path?: string): A2uiClientError {
    if (e instanceof A2uiUnsupportedError) {
      return { code: "UNSUPPORTED_COMPONENT", surfaceId: this.surfaceId, message: e.message };
    }
    if (e instanceof A2uiPathError) {
      return { code: "VALIDATION_FAILED", surfaceId: this.surfaceId, path: path ?? e.pointer, message: e.message };
    }
    return { code: "RENDER_ERROR", surfaceId: this.surfaceId, message: String((e as Error)?.message ?? e) };
  }

  /** Ids of every component reachable from a template (`componentId`) through static children. */
  private templateMembers(): Set<string> {
    const out = new Set<string>();
    const walk = (id: string) => {
      if (out.has(id)) return;
      out.add(id);
      const c = this.components.get(id);
      if (!c) return;
      staticChildren(c).forEach(walk);
      if (isTemplate(c.children)) walk(c.children.componentId);
    };
    for (const c of this.components.values()) if (isTemplate(c.children)) walk(c.children.componentId);
    return out;
  }

  private parentIndex() {
    const parents = new Map<string, { id: string; index: number }>();
    for (const c of this.components.values()) {
      staticChildren(c).forEach((childId, index) => parents.set(childId, { id: c.id, index }));
    }
    return parents;
  }
}

/** Child ids referenced directly (not through a template), in order. */
function staticChildren(c: A2uiComponent): string[] {
  return childIdsOf(c);
}

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Deep copy where every relative `{path}` becomes absolute under `scope`. */
function resolvePaths(value: unknown, scope: string): unknown {
  if (Array.isArray(value)) return value.map((v) => resolvePaths(v, scope));
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  if (typeof obj.path === "string" && Object.keys(obj).length === 1) {
    return { path: obj.path.startsWith("/") ? obj.path : `${scope}/${obj.path}` };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = k === "children" || k === "child" || k === "trigger" || k === "content" ? v : resolvePaths(v, scope);
  }
  return out;
}

function readPointer(model: unknown, segments: string[]): unknown {
  let cur = model;
  for (const s of segments) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}

/** Immutable write (A2UI upsert semantics; `undefined` deletes the key). */
function writePointer(model: unknown, segments: string[], value: unknown): unknown {
  if (!segments.length) return value ?? {};
  const [head, ...rest] = segments;
  const base: Record<string, unknown> | unknown[] =
    model && typeof model === "object" ? (Array.isArray(model) ? [...model] : { ...(model as object) }) : {};
  const next = writePointer((base as Record<string, unknown>)[head], rest, value);
  if (value === undefined && !rest.length && !Array.isArray(base)) delete (base as Record<string, unknown>)[head];
  else (base as Record<string, unknown>)[head] = next;
  return base;
}

function renameTags(node: SDUINode, mapTag: (tag: string) => string): SDUINode {
  if (node.tagName) node.tagName = mapTag(node.tagName);
  node.nodes?.forEach((child) => renameTags(child, mapTag));
  return node;
}
