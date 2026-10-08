import "@supersoniks/concorde/sdui";
import { validateSafeDescriptor } from "@supersoniks/concorde/sdui-safe";
import { a2uiBasicLibrary, agentStackLibrary, chatLibrary } from "../src/libraries";
import { SUPPORTED_COMPONENTS } from "../src/a2ui/basic-catalog";

const tick = () => new Promise((r) => setTimeout(r, 0));

it("libraries pass the safe profile", () => {
  expect(validateSafeDescriptor({ library: agentStackLibrary, nodes: [] })).toEqual([]);
});

it("every supported A2UI component has a library entry", () => {
  for (const name of SUPPORTED_COMPONENTS) expect(a2uiBasicLibrary[`a2ui:${name}`]).toBeTruthy();
  expect(Object.keys(chatLibrary)).toEqual(
    expect.arrayContaining(["chat:answer", "chat:result-card", "chat:confirm", "chat:short-form", "chat:actions"])
  );
});

it("renders a chat:confirm template with routed actions", async () => {
  const el = document.createElement("sonic-sdui") as HTMLElement & { props: unknown };
  el.setAttribute("profile", "safe");
  document.body.appendChild(el);
  const actions: unknown[] = [];
  el.addEventListener("sdui-action", (e) => actions.push((e as CustomEvent).detail));
  el.props = {
    library: agentStackLibrary,
    nodes: [
      {
        libraryKey: "chat:confirm",
        nodes: [
          { tagName: "p", textContent: "Annuler la réservation n°42 ?" },
          { libraryKey: "a2ui:Button.primary", parentElementSelector: "sonic-form-actions", textContent: "Oui", nodeId: "yes", action: { name: "cancel-booking", context: { id: 42 } } },
          { libraryKey: "a2ui:Button", parentElementSelector: "sonic-form-actions", textContent: "Non", action: { name: "dismiss" } },
        ],
      },
    ],
  };
  await tick();
  await tick();
  const main = el.querySelector("sonic-card-main");
  expect(main?.querySelector("p")?.textContent).toBe("Annuler la réservation n°42 ?");
  const buttons = el.querySelectorAll("sonic-form-actions sonic-button");
  expect(buttons).toHaveLength(2);
  (buttons[0] as HTMLElement).click();
  expect(actions[0]).toMatchObject({ name: "cancel-booking", context: { id: 42 }, sourceNodeId: "yes" });
});
