import { A2uiSurface } from "../src/a2ui/surface";
import type { A2uiComponent } from "../src/a2ui/types";

const ids = (ops: { op: string; node?: { nodeId?: string }; parentId?: string }[]) =>
  ops.map((o) => `${o.node?.nodeId}<${o.parentId ?? "-"}`);

it("emits nothing before root, then everything parent-first", () => {
  const s = new A2uiSurface("main");
  const r1 = s.updateComponents({
    components: [
      { id: "content", component: "Text", text: "hi" },
      { id: "body", component: "Card", child: "content" },
    ],
  });
  expect(r1.ops).toEqual([]);
  const r2 = s.updateComponents({
    components: [{ id: "root", component: "Column", children: ["header", "body"] }],
  });
  expect(ids(r2.ops)).toEqual(["root<-", "body<root", "content<body"]);
});

it("attaches late children and replaces updated components in place", () => {
  const s = new A2uiSurface("main");
  s.updateComponents({ components: [{ id: "root", component: "Column", children: ["a"] }] });
  const late = s.updateComponents({ components: [{ id: "a", component: "Text", text: "A" }] });
  expect(ids(late.ops)).toEqual(["a<root"]);
  const upd = s.updateComponents({ components: [{ id: "a", component: "Text", text: "A2" }] });
  expect(ids(upd.ops)).toEqual(["a<root"]);
  expect(upd.ops[0]).toMatchObject({ index: 0, node: { textContent: "A2" } });
});

it("attaches an orphan when an updated parent starts referencing it", () => {
  const s = new A2uiSurface("main");
  s.updateComponents({ components: [{ id: "root", component: "Column", children: [] }] });
  expect(s.updateComponents({ components: [{ id: "x", component: "Text", text: "X" }] }).ops).toEqual([]);
  const r = s.updateComponents({ components: [{ id: "root", component: "Column", children: ["x"] }] });
  expect(ids(r.ops)).toEqual(["root<-", "x<root"]);
});

it("produces safe nodes only", () => {
  const s = new A2uiSurface("main");
  const r = s.updateComponents({
    components: [
      { id: "root", component: "Row", children: ["t", "b"], justify: "spaceBetween" },
      { id: "t", component: "Text", text: { path: "/user/name" }, variant: "h2", weight: 1 },
      { id: "b", component: "Button", child: "bl", action: { event: { name: "go", context: { who: { path: "/user/name" } } } } },
      { id: "bl", component: "Text", text: "<b>Go</b>" },
    ] as A2uiComponent[],
  });
  const json = JSON.stringify(r.ops);
  expect(json).not.toMatch(/"(markup|innerHTML|prefix|suffix|js)"/);
  expect(r.ops.find((o) => o.op === "upsertNode" && o.node.nodeId === "b")).toMatchObject({
    node: { tagName: "sonic-button", action: { name: "go" }, childNodeIds: ["bl"] },
  });
});

it("reports unsupported components as errors without blocking the rest", () => {
  const s = new A2uiSurface("main");
  const r = s.updateComponents({
    components: [
      { id: "root", component: "Column", children: ["ok", "nope"] },
      { id: "ok", component: "Text", text: "fine" },
      { id: "nope", component: "Slider", value: { path: "/v" } },
    ],
  });
  expect(ids(r.ops)).toEqual(["root<-", "ok<root"]);
  expect(r.errors).toHaveLength(1);
  expect(r.errors[0]).toMatchObject({ code: "UNSUPPORTED_COMPONENT", surfaceId: "main" });
});

it("maps data model updates", () => {
  const s = new A2uiSurface("main");
  expect(s.updateDataModel({ path: "/", value: { a: 1 } }).ops).toEqual([
    { op: "setData", path: "a2ui_main", value: { a: 1 } },
  ]);
  expect(s.updateDataModel({ path: "/user/email", value: "x@y.z" }).ops[0]).toMatchObject({
    path: "a2ui_main.user.email",
  });
  expect(s.updateDataModel({ path: "/a.b", value: 1 }).errors[0].code).toBe("VALIDATION_FAILED");
});

it("renames tags for prefixed Concorde builds", () => {
  const s = new A2uiSurface("main", "dp", (t) => t.replace(/^sonic-/, "afx-"));
  const r = s.updateComponents({
    components: [
      { id: "root", component: "Card", child: "t" },
      { id: "t", component: "Text", text: { path: "/x" } },
    ],
  });
  const tags = JSON.stringify(r.ops).match(/"tagName":"[^"]+"/g);
  expect(tags).toEqual(['"tagName":"afx-card"', '"tagName":"p"', '"tagName":"a2ui-text"']);
});
