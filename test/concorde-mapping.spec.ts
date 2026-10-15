import { PublisherManager } from "@supersoniks/concorde/utils";
import { mapComponent, type MapContext } from "../src/a2ui/basic-catalog";
import { A2uiRenderer } from "../src/a2ui/renderer";
import { A2UI_BASIC_CATALOG_ID, type A2uiComponent } from "../src/a2ui/types";

const tick = async (n = 2) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const v = "v0.9" as const;

/** Maps one component without rendering it. */
function map(c: A2uiComponent) {
  const warnings: string[] = [];
  const ctx: MapContext = { dataProvider: "a2ui_t", warn: (m) => warnings.push(m) };
  return { node: mapComponent(c, ctx), warnings };
}

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const r = new A2uiRenderer({ container });
  r.handle({ version: v, createSurface: { surfaceId: "m", catalogId: A2UI_BASIC_CATALOG_ID } });
  const components = (list: A2uiComponent[]) => r.handle({ version: v, updateComponents: { surfaceId: "m", components: list } });
  const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector(sel) as T | null;
  return { container, components, q };
}

afterEach(() => (document.body.innerHTML = ""));

describe("Button", () => {
  it("keeps the A2UI variants working", () => {
    expect(map({ id: "b", component: "Button", variant: "primary" }).node.attributes).toMatchObject({ type: "primary" });
    expect(map({ id: "b", component: "Button", variant: "borderless" }).node.attributes).toMatchObject({ variant: "ghost" });
    expect(map({ id: "b", component: "Button" }).warnings).toEqual([]);
  });

  it("maps Concorde type, variant, size, shape and states", () => {
    const { node, warnings } = map({
      id: "b",
      component: "Button",
      type: "danger",
      variant: "outline",
      size: "lg",
      shape: "circle",
      loading: true,
      disabled: true,
      active: true,
    });
    expect(node.tagName).toBe("sonic-button");
    expect(node.attributes).toMatchObject({ type: "danger", variant: "outline", size: "lg", shape: "circle", loading: "", disabled: "", active: "" });
    expect(warnings).toEqual([]);
  });

  it("lets an explicit type win over variant primary", () => {
    const { node } = map({ id: "b", component: "Button", variant: "primary", type: "success" });
    expect(node.attributes?.type).toBe("success");
  });

  it("drops values outside the allow-lists, with a warning", () => {
    const { node, warnings } = map({ id: "b", component: "Button", type: "x onclick=alert(1)", size: "huge", variant: "fancy", shape: "blob" });
    expect(node.attributes).not.toHaveProperty("size");
    expect(node.attributes).not.toHaveProperty("shape");
    expect(node.attributes?.type).toBeUndefined();
    expect(warnings).toHaveLength(4);
  });

  it("only sets the active attribute when asked", () => {
    expect(map({ id: "b", component: "Button", active: false }).node.attributes).not.toHaveProperty("active");
  });
});

describe("text fields", () => {
  it("maps description (escaped), placeholder, required, size, status, disabled and readonly", () => {
    const { node } = map({
      id: "t",
      component: "TextField",
      label: "Nom",
      description: "<img src=x onerror=alert(1)>",
      placeholder: "Votre nom",
      required: true,
      size: "sm",
      status: "error",
      disabled: true,
      readonly: true,
      value: { path: "/name" },
    });
    expect(node.tagName).toBe("sonic-input");
    expect(node.attributes).toMatchObject({
      label: "Nom",
      description: "&#60;img src=x onerror=alert(1)&#62;",
      placeholder: "Votre nom",
      required: "",
      size: "sm",
      status: "error",
      disabled: "",
      readonly: "",
    });
  });

  it("keeps the placeholder as-is (not an HTML sink)", () => {
    expect(map({ id: "t", component: "TextField", placeholder: "a & b" }).node.attributes?.placeholder).toBe("a & b");
  });

  it("applies the shared attributes to Slider and DateTimeInput too", () => {
    expect(map({ id: "s", component: "Slider", description: "Volume", size: "xs", value: { path: "/s" } }).node.nodes?.[1].attributes).toMatchObject({
      type: "range",
      description: "Volume",
      size: "xs",
    });
    expect(map({ id: "d", component: "DateTimeInput", enableDate: true, description: "Jour", value: { path: "/d" } }).node.attributes).toMatchObject({
      type: "date",
      description: "Jour",
    });
  });

  it("rejects bound values on the new literal props like the existing ones", () => {
    expect(() => map({ id: "t", component: "TextField", required: { path: "/r" } })).toThrow(/data bindings/);
  });
});

describe("CheckBox", () => {
  it("adds description and disabled", () => {
    const field = map({ id: "c", component: "CheckBox", label: "OK", description: "<b>x</b>", disabled: true, value: { path: "/c" } }).node.nodes![1];
    expect(field.tagName).toBe("sonic-checkbox");
    expect(field.attributes).toMatchObject({ label: "OK", description: "&#60;b&#62;x&#60;/b&#62;", disabled: "" });
  });

  it("renders a switch on request and stays a boolean", async () => {
    expect(map({ id: "c", component: "CheckBox", variant: "switch", value: { path: "/c" } }).node.nodes![1].tagName).toBe("sonic-switch");
    expect(map({ id: "c", component: "CheckBox", variant: "checkbox", value: { path: "/c" } }).node.nodes![1].tagName).toBe("sonic-checkbox");

    const { components, q } = setup();
    PublisherManager.get("a2ui_m").set({ on: true });
    components([{ id: "root", component: "CheckBox", variant: "switch", label: "Actif", value: { path: "/on" } }]);
    await tick();
    const sw = q<HTMLElement & { checked: unknown }>('[data-sdui-node-id="root"] sonic-switch')!;
    expect(sw).not.toBeNull();
    expect(sw.checked).toBe(true);
  });
});

describe("ChoicePicker", () => {
  const options = [
    { label: "Petit", value: "s" },
    { label: "Grand", value: "l" },
  ];

  it("wraps the options in a fieldset that carries label, description and disabled", () => {
    const { node } = map({ id: "p", component: "ChoicePicker", label: "Taille", description: "Au choix", disabled: true, value: { path: "/p" }, options });
    expect(node.tagName).toBe("sonic-fieldset");
    expect(node.attributes).toMatchObject({ label: "Taille", description: "Au choix", disabled: "", variant: "ghost" });
    const choices = node.nodes![0];
    expect(choices.attributes?.["data-a2ui-choices"]).toBe("list");
    const radios = choices.nodes!.filter((n) => n.tagName === "sonic-radio");
    expect(radios).toHaveLength(2);
    expect(radios.every((r) => r.attributes?.disabled === "")).toBe(true);
  });

  it("escapes option labels on radios and checkboxes", () => {
    const radio = map({ id: "p", component: "ChoicePicker", value: { path: "/p" }, options: [{ label: "<i>x</i>", value: "x" }] }).node.nodes![0].nodes!.find(
      (n) => n.tagName === "sonic-radio"
    )!;
    expect(radio.attributes?.label).toBe("&#60;i&#62;x&#60;/i&#62;");
  });

  it("renders chips as toggle buttons, radio-style when exclusive", () => {
    const { node, warnings } = map({ id: "p", component: "ChoicePicker", displayStyle: "chips", size: "sm", value: { path: "/p" }, options });
    expect(warnings).toEqual([]);
    const choices = node.nodes![0];
    expect(choices.attributes?.["data-a2ui-choices"]).toBe("chips");
    const buttons = choices.nodes!.filter((n) => n.tagName === "sonic-button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Petit", "Grand"]);
    expect(buttons[0].attributes).toMatchObject({ radio: "", name: "v", value: "s", variant: "outline", size: "sm" });
    // Button text is plain text: no escaping needed, none applied.
    expect(buttons[0].attributes).not.toHaveProperty("label");
  });

  it("renders multiple-selection chips bound straight to the list, without radio", () => {
    const { node } = map({ id: "p", component: "ChoicePicker", variant: "multipleSelection", displayStyle: "chips", value: { path: "/tags" }, options });
    const buttons = node.nodes![0].nodes!.filter((n) => n.tagName === "sonic-button");
    expect(buttons[0].attributes).toMatchObject({ formDataProvider: "a2ui_t", name: "tags", value: "s" });
    expect(buttons[0].attributes).not.toHaveProperty("radio");
    expect(node.nodes![0].nodes!.some((n) => n.tagName === "a2ui-bridge")).toBe(false);
  });

  it("still ignores filterable, with a warning", () => {
    expect(map({ id: "p", component: "ChoicePicker", filterable: true, value: { path: "/p" }, options }).warnings).toEqual([
      'ChoicePicker "p": filterable is ignored',
    ]);
  });

  it("chips write the same data model shapes as radios and checkboxes", async () => {
    const { components, q, container } = setup();
    PublisherManager.get("a2ui_m").set({ one: ["l"], many: ["s"] });
    components([
      { id: "root", component: "Column", children: ["single", "multi"] },
      { id: "single", component: "ChoicePicker", displayStyle: "chips", value: { path: "/one" }, options },
      { id: "multi", component: "ChoicePicker", variant: "multipleSelection", displayStyle: "chips", value: { path: "/many" }, options },
    ]);
    await tick(3);
    const single = [...container.querySelectorAll('[data-sdui-node-id="single"] sonic-button')] as (HTMLElement & { checked: unknown })[];
    expect(single.map((b) => b.checked)).toEqual([null, true]);
    expect(single[1].hasAttribute("active")).toBe(true);
    PublisherManager.get("a2ui_m__single").v.set("s");
    await tick();
    expect((PublisherManager.get("a2ui_m").get() as { one: unknown }).one).toEqual(["s"]);
    const multi = [...container.querySelectorAll('[data-sdui-node-id="multi"] sonic-button')] as (HTMLElement & { checked: unknown })[];
    expect(multi.map((b) => b.checked)).toEqual([true, null]);
    expect(q('[data-sdui-node-id="single"]')?.tagName).toBe("SONIC-FIELDSET");
  });
});

describe("layouts", () => {
  it("keeps plain Row and Column unchanged", () => {
    expect(map({ id: "r", component: "Row", justify: "center" }).node).toMatchObject({ tagName: "div", attributes: { "data-a2ui": "Row", "data-a2ui-justify": "center" } });
    expect(map({ id: "c", component: "Column" }).node).toMatchObject({ tagName: "div", attributes: { "data-a2ui": "Column" } });
  });

  it("Column layout form becomes a sonic-form-layout", () => {
    const { node, warnings } = map({ id: "c", component: "Column", layout: "form" });
    expect(node.tagName).toBe("sonic-form-layout");
    expect(warnings).toEqual([]);
  });

  it("Row layout actions becomes a sonic-form-actions with CSS justify and align values", () => {
    const { node } = map({ id: "r", component: "Row", layout: "actions", justify: "spaceBetween", align: "end" });
    expect(node.tagName).toBe("sonic-form-actions");
    expect(node.attributes).toMatchObject({ justify: "space-between", alignItems: "flex-end" });
    // No flex-box tokens: the component brings its own layout.
    expect(node.attributes).not.toHaveProperty("data-a2ui-justify");
  });

  it("Row layout group becomes a sonic-group with escaped label and description", () => {
    const { node } = map({ id: "r", component: "Row", layout: "group", label: "<b>Durée</b>", description: "En heures", align: "center" });
    expect(node.tagName).toBe("sonic-group");
    expect(node.attributes).toMatchObject({ label: "&#60;b&#62;Durée&#60;/b&#62;", description: "En heures", alignItems: "center" });
  });

  it("ignores an unknown layout with a warning", () => {
    const { node, warnings } = map({ id: "r", component: "Row", layout: "grid" });
    expect(node.tagName).toBe("div");
    expect(warnings).toHaveLength(1);
  });

  it("renders a form with actions end to end", async () => {
    const { components, q } = setup();
    components([
      { id: "root", component: "Column", layout: "form", children: ["name", "actions"] },
      { id: "name", component: "TextField", label: "Nom", value: { path: "/name" } },
      { id: "actions", component: "Row", layout: "actions", justify: "end", children: ["ok"] },
      { id: "ok", component: "Button", variant: "primary", child: "ok-l", action: { event: { name: "save" } } },
      { id: "ok-l", component: "Text", text: "Enregistrer" },
    ]);
    await tick(3);
    expect(q('[data-sdui-node-id="root"]')?.tagName).toBe("SONIC-FORM-LAYOUT");
    expect(q('[data-sdui-node-id="root"] > [data-sdui-node-id="name"]')?.tagName).toBe("SONIC-INPUT");
    const actions = q('[data-sdui-node-id="root"] > [data-sdui-node-id="actions"]')!;
    expect(actions.tagName).toBe("SONIC-FORM-ACTIONS");
    expect(actions.getAttribute("justify")).toBe("flex-end");
    expect(actions.querySelector('[data-sdui-node-id="ok"]')?.tagName).toBe("SONIC-BUTTON");
  });
});
