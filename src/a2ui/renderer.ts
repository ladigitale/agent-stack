import "@supersoniks/concorde/sdui";
import "../libraries/components";
import type { SDUIOp } from "@supersoniks/concorde/core/components/functional/sdui/types";
import { Objects, PublisherManager } from "@supersoniks/concorde/utils";
import { injectAgentStackStyles } from "../libraries/styles";
import { defineA2uiElements } from "./elements";
import { A2uiSurface, type SurfaceResult } from "./surface";
import {
  A2UI_BASIC_CATALOG_ID,
  A2UI_VERSION,
  type A2uiClientError,
  type A2uiClientMessage,
  type A2uiServerMessage,
} from "./types";

type SduiElement = HTMLElement & { applyOp(op: SDUIOp): void };

export type A2uiRendererOptions = {
  /** Element that receives one `<sonic-sdui>` per surface. */
  container?: HTMLElement;
  /** Picks the container of a new surface (e.g. the chat message it belongs to). Wins over `container`. */
  resolveContainer?: (surfaceId: string) => HTMLElement;
  /** Inject the layout CSS of the `a2ui-basic` library into the document. Default: true. */
  injectStyles?: boolean;
  /** Called with every message to send back to the agent (actions, errors). */
  onClientMessage?: (msg: A2uiClientMessage) => void;
  /** Called with non-fatal notices (ignored features, approximations). */
  onWarning?: (message: string, surfaceId: string) => void;
  /** Catalogs this renderer accepts. Defaults to the A2UI basic catalog. */
  supportedCatalogIds?: string[];
};

type Mounted = { surface: A2uiSurface; element: SduiElement; onAction: (e: Event) => void };

/**
 * Renders A2UI v0.9 messages with Concorde: one `<sonic-sdui profile="safe" partial>`
 * per surface, fed with incremental ops. User actions come back as A2UI
 * `action` messages through `onClientMessage`.
 */
export class A2uiRenderer {
  private surfaces = new Map<string, Mounted>();
  private catalogs: Set<string>;

  constructor(private readonly options: A2uiRendererOptions) {
    defineA2uiElements();
    if (options.injectStyles !== false) injectAgentStackStyles();
    if (!options.container && !options.resolveContainer) {
      throw new Error("A2uiRenderer: `container` or `resolveContainer` is required");
    }
    this.catalogs = new Set(options.supportedCatalogIds ?? [A2UI_BASIC_CATALOG_ID]);
  }

  /** Capabilities to attach to outbound transport metadata (`a2uiClientCapabilities`). */
  get clientCapabilities() {
    return { supportedCatalogIds: [...this.catalogs] };
  }

  handle(message: A2uiServerMessage): void {
    if (message.version !== A2UI_VERSION) {
      this.sendError({
        code: "UNSUPPORTED_VERSION",
        surfaceId: surfaceIdOf(message) ?? "",
        message: `Unsupported A2UI version "${message.version}", expected ${A2UI_VERSION}`,
      });
      return;
    }
    if ("createSurface" in message) return this.createSurface(message.createSurface);
    if ("deleteSurface" in message) return this.deleteSurface(message.deleteSurface.surfaceId);
    if ("updateComponents" in message) {
      const m = message.updateComponents;
      return this.withSurface(m.surfaceId, (s) => s.surface.updateComponents(m));
    }
    if ("updateDataModel" in message) {
      const m = message.updateDataModel;
      return this.withSurface(m.surfaceId, (s) => s.surface.updateDataModel(m));
    }
  }

  /** Feeds JSONL / SSE payloads: one JSON message per line. */
  handleText(chunk: string): void {
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) this.handle(JSON.parse(trimmed) as A2uiServerMessage);
    }
  }

  deleteSurface(surfaceId: string): void {
    const mounted = this.surfaces.get(surfaceId);
    if (!mounted) return;
    mounted.element.removeEventListener("sdui-action", mounted.onAction);
    mounted.element.remove();
    PublisherManager.get(mounted.surface.dataProvider).set({});
    this.surfaces.delete(surfaceId);
  }

  destroy(): void {
    for (const id of [...this.surfaces.keys()]) this.deleteSurface(id);
  }

  private createSurface({ surfaceId, catalogId }: { surfaceId: string; catalogId: string }) {
    if (this.surfaces.has(surfaceId)) {
      this.sendError({ code: "SURFACE_EXISTS", surfaceId, message: `Surface "${surfaceId}" already exists` });
      return;
    }
    if (!this.catalogs.has(catalogId)) {
      this.sendError({ code: "UNSUPPORTED_CATALOG", surfaceId, message: `Catalog "${catalogId}" is not supported` });
      return;
    }
    const surface = new A2uiSurface(surfaceId);
    const element = document.createElement("sonic-sdui") as SduiElement;
    element.setAttribute("profile", "safe");
    element.setAttribute("partial", "");
    element.setAttribute("data-a2ui-surface", surfaceId);
    PublisherManager.get(surface.dataProvider).set({});

    const onAction = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const action = surface.buildClientAction(detail, (path) => readPath(path));
      this.options.onClientMessage?.({ version: A2UI_VERSION, action });
    };
    element.addEventListener("sdui-action", onAction);
    const container = this.options.resolveContainer?.(surfaceId) ?? this.options.container!;
    container.appendChild(element);
    this.surfaces.set(surfaceId, { surface, element, onAction });
  }

  private withSurface(surfaceId: string, run: (s: Mounted) => SurfaceResult) {
    const mounted = this.surfaces.get(surfaceId);
    if (!mounted) {
      this.sendError({ code: "UNKNOWN_SURFACE", surfaceId, message: `Surface "${surfaceId}" does not exist` });
      return;
    }
    const { ops, errors, warnings } = run(mounted);
    for (const op of ops) mounted.element.applyOp(op);
    for (const w of warnings) this.options.onWarning?.(w, surfaceId);
    for (const err of errors) this.sendError(err);
  }

  private sendError(error: A2uiClientError) {
    this.options.onClientMessage?.({ version: A2UI_VERSION, error });
  }
}

function readPath(path: string): unknown {
  const [provider, ...segments] = path.split(".");
  const publisher = Objects.traverse(PublisherManager.get(provider), segments);
  return publisher?.get();
}

function surfaceIdOf(message: Record<string, unknown>): string | undefined {
  for (const v of Object.values(message)) {
    if (v && typeof v === "object" && "surfaceId" in v) return String((v as { surfaceId: unknown }).surfaceId);
  }
  return undefined;
}
