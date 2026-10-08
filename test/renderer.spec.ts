import { PublisherManager } from "@supersoniks/concorde/utils";
import { A2uiRenderer } from "../src/a2ui/renderer";
import { A2UI_BASIC_CATALOG_ID, type A2uiClientMessage, type A2uiServerMessage } from "../src/a2ui/types";

const tick = () => new Promise((r) => setTimeout(r, 0));
const v = "v0.9" as const;

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const sent: A2uiClientMessage[] = [];
  const warnings: string[] = [];
  const renderer = new A2uiRenderer({
    container,
    onClientMessage: (m) => sent.push(m),
    onWarning: (w) => warnings.push(w),
  });
  const q = (id: string) => container.querySelector(`[data-sdui-node-id="${id}"]`) as HTMLElement | null;
  return { container, renderer, sent, warnings, q };
}

const create = (surfaceId = "main"): A2uiServerMessage => ({
  version: v,
  createSurface: { surfaceId, catalogId: A2UI_BASIC_CATALOG_ID },
});

afterEach(() => (document.body.innerHTML = ""));

it("streams a surface message by message, children before parents", async () => {
  const { renderer, container, q } = setup();
  await tick();
  renderer.handle(create());
  await tick();
  const stream = [
    { id: "content", component: "Text", text: { path: "/message" } },
    { id: "header", component: "Text", text: "Welcome", variant: "h1" },
    { id: "root", component: "Column", children: ["header", "body"] },
    { id: "body", component: "Card", child: "content" },
  ];
  for (const c of stream) {
    renderer.handle({ version: v, updateComponents: { surfaceId: "main", components: [c] } });
  }
  renderer.handle({ version: v, updateDataModel: { surfaceId: "main", path: "/message", value: "Bonjour" } });
  await tick();

  expect(q("header")?.tagName).toBe("H1");
  expect(q("body")?.tagName).toBe("SONIC-CARD");
  expect(q("content")?.textContent).toBe("Bonjour");
  // No duplicates, no leftover placeholder.
  for (const id of ["root", "header", "body", "content"]) {
    expect(container.querySelectorAll(`[data-sdui-node-id="${id}"]`)).toHaveLength(1);
  }
  expect(container.querySelector("[data-sdui-placeholder]")).toBeNull();
});

it("keeps bound text reactive and never parses data as HTML", async () => {
  const { renderer, q } = setup();
  renderer.handle(create());
  renderer.handle({
    version: v,
    updateComponents: { surfaceId: "main", components: [{ id: "root", component: "Text", text: { path: "/t" } }] },
  });
  renderer.handle({ version: v, updateDataModel: { surfaceId: "main", path: "/", value: { t: "<img src=x onerror=alert(1)>" } } });
  await tick();
  expect(q("root")?.querySelector("img")).toBeNull();
  expect(q("root")?.textContent).toBe("<img src=x onerror=alert(1)>");
  renderer.handle({ version: v, updateDataModel: { surfaceId: "main", path: "/t", value: 42 } });
  await tick();
  expect(q("root")?.textContent).toBe("42");
});

it("binds text fields to the surface data model", async () => {
  const { renderer, q } = setup();
  renderer.handle(create());
  renderer.handle({
    version: v,
    updateComponents: {
      surfaceId: "main",
      components: [{ id: "root", component: "TextField", label: "Email", value: { path: "/form/email" } }],
    },
  });
  await tick();
  const field = q("root")!;
  expect(field.tagName).toBe("SONIC-INPUT");
  expect(field.getAttribute("formDataProvider")).toBe("a2ui_main");
  expect(field.getAttribute("name")).toBe("form.email");
});

it("sends A2UI actions with resolved context", async () => {
  const { renderer, sent, q } = setup();
  renderer.handle(create());
  renderer.handle({ version: v, updateDataModel: { surfaceId: "main", path: "/", value: { user: { name: "Alice" } } } });
  renderer.handle({
    version: v,
    updateComponents: {
      surfaceId: "main",
      components: [
        { id: "root", component: "Button", child: "label", action: { event: { name: "greet", context: { who: { path: "/user/name" }, n: 1 } } } },
        { id: "label", component: "Text", text: "Hello" },
      ],
    },
  });
  await tick();
  q("root")!.click();
  expect(sent).toHaveLength(1);
  const action = (sent[0] as { action: Record<string, unknown> }).action;
  expect(action).toMatchObject({ name: "greet", surfaceId: "main", sourceComponentId: "root", context: { who: "Alice", n: 1 } });
  expect(typeof action.timestamp).toBe("string");
});

it("reports errors back instead of failing silently", async () => {
  const { renderer, sent } = setup();
  renderer.handle({ version: v, updateComponents: { surfaceId: "ghost", components: [] } });
  renderer.handle({ version: v, createSurface: { surfaceId: "x", catalogId: "urn:other" } });
  renderer.handle(create());
  renderer.handle(create());
  const codes = sent.map((m) => ("error" in m ? m.error.code : "action"));
  expect(codes).toEqual(["UNKNOWN_SURFACE", "UNSUPPORTED_CATALOG", "SURFACE_EXISTS"]);
});

it("deletes a surface and its data", async () => {
  const { renderer, container } = setup();
  renderer.handle(create());
  renderer.handle({ version: v, updateDataModel: { surfaceId: "main", path: "/", value: { a: 1 } } });
  renderer.handle({ version: v, deleteSurface: { surfaceId: "main" } });
  expect(container.querySelector("sonic-sdui")).toBeNull();
  expect(PublisherManager.get("a2ui_main").get()).toEqual({});
});

it("accepts JSONL chunks", async () => {
  const { renderer, q } = setup();
  renderer.handleText(
    [
      JSON.stringify(create()),
      JSON.stringify({ version: v, updateComponents: { surfaceId: "main", components: [{ id: "root", component: "Text", text: "jsonl" }] } }),
      "",
    ].join("\n")
  );
  await tick();
  expect(q("root")?.textContent).toBe("jsonl");
});

it("keeps renderers apart with a data provider prefix and a shadow-root style target", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  shadow.appendChild(container);
  const renderer = new A2uiRenderer({ container, styleTarget: shadow, dataProviderPrefix: "embed1__a2ui_" });
  renderer.handle(create());
  renderer.handle({ version: v, updateDataModel: { surfaceId: "main", path: "/", value: { t: "isolé" } } });
  renderer.handle({
    version: v,
    updateComponents: { surfaceId: "main", components: [{ id: "root", component: "Text", text: { path: "/t" } }] },
  });
  await tick();
  expect(PublisherManager.get("embed1__a2ui_main").get()).toEqual({ t: "isolé" });
  expect(container.querySelector('[data-sdui-node-id="root"]')?.textContent).toBe("isolé");
  expect(shadow.getElementById("agent-stack-styles")).not.toBeNull();
});
