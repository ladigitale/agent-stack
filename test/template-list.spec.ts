import { A2uiRenderer } from "../src/a2ui/renderer";
import { A2UI_BASIC_CATALOG_ID, type A2uiClientMessage, type A2uiComponent } from "../src/a2ui/types";

const tick = () => new Promise((r) => setTimeout(r, 0));
const v = "v0.9" as const;

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const sent: A2uiClientMessage[] = [];
  const r = new A2uiRenderer({ container, onClientMessage: (m) => sent.push(m) });
  r.handle({ version: v, createSurface: { surfaceId: "s", catalogId: A2UI_BASIC_CATALOG_ID } });
  const components = (components: A2uiComponent[]) => r.handle({ version: v, updateComponents: { surfaceId: "s", components } });
  const data = (path: string, value: unknown) => r.handle({ version: v, updateDataModel: { surfaceId: "s", path, value } });
  const texts = (sel: string) => [...container.querySelectorAll(sel)].map((e) => e.textContent);
  return { container, sent, components, data, texts };
}

const scores: A2uiComponent[] = [
  { id: "root", component: "List", children: { path: "/scores", componentId: "row" } },
  { id: "row", component: "Row", children: ["name", "pts"] },
  { id: "name", component: "Text", text: { path: "name" } },
  { id: "pts", component: "Text", text: { path: "points" } },
];

it("renders one template instance per item, with relative bindings", async () => {
  const { components, data, texts, container } = setup();
  data("/", { scores: [{ name: "Ana", points: 12 }, { name: "Bo", points: 7 }] });
  components(scores);
  await tick();
  expect(texts('[data-a2ui="Row"]')).toEqual(["Ana12", "Bo7"]);
  expect(container.querySelector('[data-sdui-node-id="name@root/1"]')?.textContent).toBe("Bo");
  expect(container.querySelector("[data-sdui-placeholder]")).toBeNull();
});

it("follows the array: grows, shrinks, item values stay reactive", async () => {
  const { components, data, texts } = setup();
  components(scores);
  data("/scores", [{ name: "Ana", points: 1 }]);
  await tick();
  expect(texts('[data-a2ui="Row"]')).toEqual(["Ana1"]);
  data("/scores", [{ name: "Ana", points: 1 }, { name: "Bo", points: 2 }, { name: "Cy", points: 3 }]);
  await tick();
  expect(texts('[data-a2ui="Row"]')).toEqual(["Ana1", "Bo2", "Cy3"]);
  data("/scores/0/points", 99);
  await tick();
  expect(texts('[data-a2ui="Row"]')).toEqual(["Ana99", "Bo2", "Cy3"]);
  data("/scores", [{ name: "Cy", points: 3 }]);
  await tick();
  expect(texts('[data-a2ui="Row"]')).toEqual(["Cy3"]);
});

it("accepts the template after the list and rebuilds on template change", async () => {
  const { components, data, texts } = setup();
  data("/", { scores: [{ name: "Ana", points: 1 }, { name: "Bo", points: 2 }] });
  components([scores[0]]);
  components(scores.slice(1));
  await tick();
  expect(texts('[data-a2ui="Row"]')).toEqual(["Ana1", "Bo2"]);
  components([{ id: "pts", component: "Text", text: "—" }]);
  await tick();
  expect(texts('[data-a2ui="Row"]')).toEqual(["Ana—", "Bo—"]);
});

it("supports nested template lists and resolves relative action context", async () => {
  const { components, data, container, sent } = setup();
  data("/", { teams: [{ name: "A", players: [{ n: "a1" }, { n: "a2" }] }, { name: "B", players: [{ n: "b1" }] }] });
  components([
    { id: "root", component: "Column", children: { path: "/teams", componentId: "team" } },
    { id: "team", component: "Card", child: "team-col" },
    { id: "team-col", component: "Column", children: ["team-name", "players"] },
    { id: "team-name", component: "Text", text: { path: "name" } },
    { id: "players", component: "List", children: { path: "players", componentId: "player" } },
    { id: "player", component: "Button", child: "player-name", action: { event: { name: "pick", context: { who: { path: "n" } } } } },
    { id: "player-name", component: "Text", text: { path: "n" } },
  ]);
  await tick();
  const buttons = [...container.querySelectorAll('[data-a2ui="Button"]')] as HTMLElement[];
  expect(buttons.map((b) => b.textContent)).toEqual(["a1", "a2", "b1"]);
  buttons[2].click();
  expect((sent.at(-1) as { action: { context: unknown } }).action.context).toEqual({ who: "b1" });
});
