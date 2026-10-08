import "@supersoniks/concorde/core/components/ui/theme/theme";
import "../src/chat/sonic-chat";
import { A2UI_BASIC_CATALOG_ID } from "../src/a2ui/types";
import type { AgUiEvent, RunAgentInput } from "../src/chat/ag-ui";
import { ReplayTransport } from "../src/chat/transport";

const v = "v0.9" as const;
let n = 0;

function say(...parts: string[]): AgUiEvent[] {
  const messageId = `m${++n}`;
  return [
    { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
    ...parts.map((delta) => ({ type: "TEXT_MESSAGE_CONTENT", messageId, delta }) as AgUiEvent),
    { type: "TEXT_MESSAGE_END", messageId },
  ];
}

/** Scripted agent: an A2UI booking card, then an SDUI confirmation. */
function script(input: RunAgentInput): AgUiEvent[] {
  const fp = input.forwardedProps ?? {};
  const action = (fp.a2uiAction as { action?: { name: string; context: Record<string, unknown> } })?.action;
  const sdui = fp.sduiAction as { name: string } | undefined;

  if (action?.name === "book") {
    const { qty, show } = action.context;
    return [
      ...say(`Je prépare ${qty} place(s) pour « ${show} ».`),
      {
        type: "CUSTOM",
        name: "sdui",
        value: {
          nodes: [
            {
              libraryKey: "chat:confirm",
              nodes: [
                { tagName: "p", textContent: `Confirmer la réservation de ${qty} place(s) ?` },
                { libraryKey: "a2ui:Button.primary", parentElementSelector: "sonic-form-actions", textContent: "Confirmer", action: { name: "confirm", context: { qty } } },
                { libraryKey: "a2ui:Button", parentElementSelector: "sonic-form-actions", textContent: "Annuler", action: { name: "dismiss" } },
              ],
            },
          ],
        },
      },
    ];
  }
  if (sdui?.name === "confirm") return say("C'est réservé. Le billet part par e-mail.");
  if (sdui?.name === "dismiss") return say("D'accord, rien n'est réservé.");

  const surfaceId = `booking-${++n}`;
  return [
    { type: "RUN_STARTED", threadId: input.threadId, runId: input.runId },
    { type: "TOOL_CALL_START", toolCallId: "t1", toolCallName: "search_shows" },
    { type: "TOOL_CALL_END", toolCallId: "t1" },
    ...say("Il reste des places pour ce concert ", "samedi soir :"),
    {
      type: "CUSTOM",
      name: "a2ui",
      value: [
        { version: v, createSurface: { surfaceId, catalogId: A2UI_BASIC_CATALOG_ID } },
        // Children before parents, as a streaming agent would send them.
        {
          version: v,
          updateComponents: {
            surfaceId,
            components: [
              { id: "title", component: "Text", variant: "h3", text: { path: "/show/title" } },
              { id: "when", component: "Text", variant: "caption", text: { path: "/show/when" } },
              { id: "left", component: "Text", text: { path: "/show/left" } },
              { id: "qty", component: "TextField", label: "Nombre de places", variant: "number", value: { path: "/form/qty" } },
              { id: "book-label", component: "Text", text: "Réserver" },
              {
                id: "book",
                component: "Button",
                variant: "primary",
                child: "book-label",
                action: { event: { name: "book", context: { qty: { path: "/form/qty" }, show: { path: "/show/title" } } } },
              },
            ],
          },
        },
        {
          version: v,
          updateComponents: {
            surfaceId,
            components: [
              { id: "root", component: "Card", child: "col" },
              { id: "col", component: "Column", children: ["title", "when", "left", "row"] },
              { id: "row", component: "Row", align: "end", children: ["qty", "book"] },
            ],
          },
        },
        {
          version: v,
          updateDataModel: {
            surfaceId,
            path: "/",
            value: {
              show: { title: "Orchestre d'harmonie de Monts", when: "Samedi 20 h 30 — Espace culturel", left: "38 places restantes" },
              form: { qty: 2 },
            },
          },
        },
      ],
    },
    { type: "RUN_FINISHED", threadId: input.threadId, runId: input.runId },
  ];
}

document.querySelector("sonic-chat")!.transport = new ReplayTransport(script, 40);
