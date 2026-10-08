import type { SDUINode, SDUIOp } from "@supersoniks/concorde/core/components/functional/sdui/types";
import { A2uiUnsupportedError, childIdsOf, mapComponent } from "./basic-catalog";
import { A2uiPathError, pointerToPath } from "./pointer";
import type {
  A2uiAction,
  A2uiClientAction,
  A2uiClientError,
  A2uiComponent,
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

/**
 * Pure state machine for one A2UI surface: turns A2UI messages into Concorde
 * SDUI incremental ops. It does not touch the DOM.
 *
 * Ordering rule: a component is only upserted once its parent has been, so
 * Concorde never has to invent a parent (see docs/concorde-gaps.md, gap 3).
 * Components whose parent is unknown are kept until a parent references them.
 * Nothing is emitted until the `root` component exists, as the spec requires.
 */
export class A2uiSurface {
  readonly dataProvider: string;
  private components = new Map<string, A2uiComponent>();
  private emitted = new Set<string>();

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
    const visit = (id: string, parentId?: string, index?: number) => {
      const c = this.components.get(id);
      if (!c || visited.has(id)) return; // not arrived yet: Concorde shows a placeholder
      visited.add(id);
      const node = this.toNode(c, result);
      if (!node) return;
      result.ops.push({ op: "upsertNode", node, ...(parentId ? { parentId, index } : {}) });
      this.emitted.add(id);
      // Children that arrived earlier (or in this batch) are now attachable.
      childIdsOf(c).forEach((childId, i) => {
        if (!this.emitted.has(childId)) visit(childId, id, i);
      });
    };

    for (const c of msg.components) {
      if (c.id === A2UI_ROOT_ID) {
        visit(c.id);
        continue;
      }
      const parent = parents.get(c.id);
      // New component, or update of an emitted one (replaced in place).
      if (parent && this.emitted.has(parent.id)) visit(c.id, parent.id, parent.index);
    }
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
      result.ops.push({ op: "setData", path, value: msg.value });
    } catch (e) {
      result.errors.push(this.errorFrom(e, pointer));
    }
    return result;
  }

  /** Raw A2UI action of a component, if any (for building the outbound event). */
  actionOf(componentId: string): A2uiAction | undefined {
    return this.components.get(componentId)?.action;
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

  private toNode(c: A2uiComponent, result: SurfaceResult): SDUINode | null {
    try {
      const node = renameTags(
        mapComponent(c, {
          dataProvider: this.dataProvider,
          warn: (m) => result.warnings.push(m),
        }),
        this.mapTag
      );
      node.nodeId = c.id;
      const children = childIdsOf(c);
      if (children.length) node.childNodeIds = [...children];
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

  private parentIndex() {
    const parents = new Map<string, { id: string; index: number }>();
    for (const c of this.components.values()) {
      childIdsOf(c).forEach((childId, index) => parents.set(childId, { id: c.id, index }));
    }
    return parents;
  }
}

function renameTags(node: SDUINode, mapTag: (tag: string) => string): SDUINode {
  if (node.tagName) node.tagName = mapTag(node.tagName);
  node.nodes?.forEach((child) => renameTags(child, mapTag));
  return node;
}
