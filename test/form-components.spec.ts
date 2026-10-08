import { PublisherManager } from "@supersoniks/concorde/utils";
import { A2uiRenderer } from "../src/a2ui/renderer";
import { A2UI_BASIC_CATALOG_ID, type A2uiClientMessage, type A2uiComponent } from "../src/a2ui/types";

const tick = async (n = 2) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const v = "v0.9" as const;

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const sent: A2uiClientMessage[] = [];
  const r = new A2uiRenderer({ container, onClientMessage: (m) => sent.push(m) });
  r.handle({ version: v, createSurface: { surfaceId: "f", catalogId: A2UI_BASIC_CATALOG_ID } });
  const components = (components: A2uiComponent[]) => r.handle({ version: v, updateComponents: { surfaceId: "f", components } });
  const data = (path: string, value: unknown) => r.handle({ version: v, updateDataModel: { surfaceId: "f", path, value } });
  const model = () => PublisherManager.get("a2ui_f").get() as Record<string, unknown>;
  const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector(sel) as T | null;
  return { container, sent, components, data, model, q };
}

it("CheckBox keeps a boolean in the data model", async () => {
  const { components, data, model, q } = setup();
  data("/", { ok: true });
  components([{ id: "root", component: "CheckBox", label: "<b>J'accepte</b>", value: { path: "/ok" } }]);
  await tick();
  const box = q<HTMLElement & { checked: unknown; label: string }>('[data-sdui-node-id="root"] sonic-checkbox')!;
  expect(box.checked).toBe(true);
  expect(box.getAttribute("label")).toBe("&#60;b&#62;J&#39;accepte&#60;/b&#62;");
  box.checked = null;
  (box as unknown as { updateDataValue(): void }).updateDataValue();
  await tick();
  expect(model().ok).toBe(false);
  data("/ok", true);
  await tick();
  expect(box.checked).toBe(true);
});

it("ChoicePicker writes a string list, single or multiple", async () => {
  const { components, data, model, container } = setup();
  data("/", { one: ["b"], many: ["x"] });
  components([
    { id: "root", component: "Column", children: ["single", "multi"] },
    { id: "single", component: "ChoicePicker", label: "Taille", value: { path: "/one" }, options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] },
    {
      id: "multi",
      component: "ChoicePicker",
      variant: "multipleSelection",
      value: { path: "/many" },
      options: [{ label: "X", value: "x" }, { label: "Y", value: "y" }],
    },
  ]);
  await tick(3);
  const radios = [...container.querySelectorAll('[data-sdui-node-id="single"] sonic-radio')] as (HTMLElement & { checked: unknown })[];
  expect(radios.map((r) => r.checked)).toEqual([null, true]);
  expect(container.querySelector('[data-sdui-node-id="single"] [data-a2ui-label]')?.textContent).toBe("Taille");
  PublisherManager.get("a2ui_f__single").v.set("a");
  await tick();
  expect(model().one).toEqual(["a"]);
  const boxes = [...container.querySelectorAll('[data-sdui-node-id="multi"] sonic-checkbox')] as (HTMLElement & { checked: unknown })[];
  expect(boxes.map((b) => b.checked)).toEqual([true, null]);
});

it("Slider keeps a number", async () => {
  const { components, data, model, q } = setup();
  data("/", { vol: 3 });
  components([{ id: "root", component: "Slider", min: 0, max: 10, value: { path: "/vol" } }]);
  await tick();
  expect(q('[data-sdui-node-id="root"] sonic-input')?.getAttribute("type")).toBe("range");
  expect(PublisherManager.get("a2ui_f__root").v.get()).toBe("3");
  PublisherManager.get("a2ui_f__root").v.set("7");
  await tick();
  expect(model().vol).toBe(7);
});

it("DateTimeInput picks the input type", async () => {
  const { components, q } = setup();
  components([
    { id: "root", component: "Row", children: ["d", "t", "dt"] },
    { id: "d", component: "DateTimeInput", enableDate: true, value: { path: "/d" } },
    { id: "t", component: "DateTimeInput", enableTime: true, value: { path: "/t" } },
    { id: "dt", component: "DateTimeInput", enableDate: true, enableTime: true, value: { path: "/dt" } },
  ]);
  await tick();
  expect(["d", "t", "dt"].map((id) => q(`[data-sdui-node-id="${id}"]`)?.getAttribute("type"))).toEqual(["date", "time", "datetime-local"]);
});

it("Tabs shows one child at a time, titles as text", async () => {
  const { components, q } = setup();
  components([
    { id: "root", component: "Tabs", tabs: [{ title: "<i>Un</i>", child: "a" }, { title: "Deux", child: "b" }] },
    { id: "a", component: "Text", text: "contenu A" },
    { id: "b", component: "Text", text: "contenu B" },
  ]);
  await tick();
  const tabs = q('[data-sdui-node-id="root"]')!;
  const buttons = [...tabs.shadowRoot!.querySelectorAll("button")];
  expect(buttons.map((b) => b.textContent)).toEqual(["<i>Un</i>", "Deux"]);
  const slot = tabs.shadowRoot!.querySelector("slot")!;
  expect(slot.name).toBe("tab-0");
  expect(q('[data-sdui-node-id="b"]')?.getAttribute("slot")).toBe("tab-1");
  buttons[1].click();
  expect(tabs.shadowRoot!.querySelector("slot")!.name).toBe("tab-1");
});

it("Modal opens its content from the trigger", async () => {
  const { components, q } = setup();
  components([
    { id: "root", component: "Modal", trigger: "open", content: "body" },
    { id: "open", component: "Button", child: "open-l", action: { event: { name: "noop" } } },
    { id: "open-l", component: "Text", text: "Détails" },
    { id: "body", component: "Text", text: "Le détail" },
  ]);
  await tick();
  const modal = q('[data-sdui-node-id="root"]')!;
  expect(q('[data-sdui-node-id="open"]')?.getAttribute("slot")).toBe("trigger");
  expect(q('[data-sdui-node-id="body"]')?.getAttribute("slot")).toBe("content");
  const dialog = modal.shadowRoot!.querySelector("dialog")! as HTMLDialogElement & { showModal: () => void };
  let opened = false;
  dialog.showModal = () => (opened = true);
  q('[data-sdui-node-id="open"]')!.click();
  expect(opened).toBe(true);
});
