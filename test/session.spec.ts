import { ChatSession } from "../src/chat/session";
import { ReplayTransport } from "../src/chat/transport";
import type { AgUiEvent, RunAgentInput } from "../src/chat/ag-ui";
import { A2UI_BASIC_CATALOG_ID } from "../src/a2ui/types";

const tick = () => new Promise((r) => setTimeout(r, 0));
const v = "v0.9" as const;

function textRun(id: string, ...parts: string[]): AgUiEvent[] {
  return [
    { type: "TEXT_MESSAGE_START", messageId: id, role: "assistant" },
    ...parts.map((delta) => ({ type: "TEXT_MESSAGE_CONTENT", messageId: id, delta }) as AgUiEvent),
    { type: "TEXT_MESSAGE_END", messageId: id },
  ];
}

it("streams assistant text and keeps the history for the next run", async () => {
  const inputs: RunAgentInput[] = [];
  const session = new ChatSession({
    transport: new ReplayTransport((input) => (inputs.push(input), textRun(`m${inputs.length}`, "Bon", "jour"))),
  });
  await session.send("Salut");
  await session.send("Encore");
  expect(session.items.filter((i) => i.kind === "text").map((i) => (i as { text: string }).text)).toEqual([
    "Salut",
    "Bonjour",
    "Encore",
    "Bonjour",
  ]);
  expect(inputs[1].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  expect(inputs[1].threadId).toBe(inputs[0].threadId);
  expect(inputs[0].forwardedProps?.a2uiClientCapabilities).toEqual({ supportedCatalogIds: [A2UI_BASIC_CATALOG_ID] });
});

it("renders A2UI carried in CUSTOM events and sends actions as a new run", async () => {
  const inputs: RunAgentInput[] = [];
  const session = new ChatSession({
    transport: new ReplayTransport((input) => {
      inputs.push(input);
      if (input.forwardedProps?.a2uiAction) return textRun("done", "Réservation annulée.");
      return [
        {
          type: "CUSTOM",
          name: "a2ui",
          value: [
            { version: v, createSurface: { surfaceId: "s1", catalogId: A2UI_BASIC_CATALOG_ID } },
            {
              version: v,
              updateComponents: {
                surfaceId: "s1",
                components: [
                  { id: "root", component: "Button", child: "l", variant: "primary", action: { event: { name: "cancel", context: { id: 42 } } } },
                  { id: "l", component: "Text", text: "Annuler" },
                ],
              },
            },
          ],
        },
      ];
    }),
  });
  document.body.appendChild(document.createElement("div")); // keep jsdom busy-free
  await session.send("Annule ma résa");
  const ui = session.items.find((i) => i.kind === "ui") as { host: HTMLElement };
  document.body.appendChild(ui.host);
  await tick();
  const button = ui.host.querySelector('[data-sdui-node-id="root"]') as HTMLElement;
  expect(button.tagName).toBe("SONIC-BUTTON");
  button.click();
  await tick();
  expect(inputs).toHaveLength(2);
  expect(inputs[1].forwardedProps?.a2uiAction).toMatchObject({ version: v, action: { name: "cancel", surfaceId: "s1", context: { id: 42 } } });
  expect(session.items.at(-1)).toMatchObject({ kind: "text", text: "Réservation annulée." });
});

it("renders SDUI descriptors with the chat library", async () => {
  const inputs: RunAgentInput[] = [];
  const session = new ChatSession({
    transport: new ReplayTransport((input) =>
      (inputs.push(input),
      input.forwardedProps?.sduiAction
        ? []
        : [
            {
              type: "CUSTOM",
              name: "sdui",
              value: {
                nodes: [
                  {
                    libraryKey: "chat:confirm",
                    nodes: [
                      { tagName: "p", textContent: "Confirmer ?" },
                      { libraryKey: "a2ui:Button.primary", parentElementSelector: "sonic-form-actions", textContent: "Oui", action: { name: "yes" } },
                    ],
                  },
                ],
              },
            },
          ])
    ),
  });
  await session.send("go");
  const ui = session.items.find((i) => i.kind === "ui") as { host: HTMLElement };
  document.body.appendChild(ui.host);
  await tick();
  await tick();
  (ui.host.querySelector("sonic-form-actions sonic-button") as HTMLElement).click();
  await tick();
  expect(inputs[1].forwardedProps?.sduiAction).toMatchObject({ name: "yes" });
});

it("queues A2UI errors for the next run and shows run errors", async () => {
  const inputs: RunAgentInput[] = [];
  const session = new ChatSession({
    transport: new ReplayTransport((input) => {
      inputs.push(input);
      return inputs.length === 1
        ? [
            { type: "CUSTOM", name: "a2ui", value: { version: v, updateComponents: { surfaceId: "nope", components: [] } } },
            { type: "RUN_ERROR", message: "LLM indisponible" },
          ]
        : [];
    }),
  });
  await session.send("a");
  expect(session.items.at(-1)).toMatchObject({ kind: "error", message: "LLM indisponible" });
  await session.send("b");
  expect(inputs[1].forwardedProps?.a2uiErrors).toEqual([expect.objectContaining({ code: "UNKNOWN_SURFACE" })]);
  expect(inputs[1].forwardedProps?.a2uiErrors).toHaveLength(1);
});
