import { vi } from "vitest";
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

it("passes app-specific CUSTOM events through and merges forwardedProps", async () => {
  const inputs: RunAgentInput[] = [];
  const custom: [string, unknown][] = [];
  const session = new ChatSession({
    transport: new ReplayTransport((input) => (inputs.push(input), [{ type: "CUSTOM", name: "artifact-preview", value: { title: "X" } }])),
    forwardedProps: () => ({ artifact: { slug: "quiz" } }),
    onCustom: (name, value) => custom.push([name, value]),
  });
  await session.send("go");
  expect(custom).toEqual([["artifact-preview", { title: "X" }]]);
  expect(inputs[0].forwardedProps?.artifact).toEqual({ slug: "quiz" });
  expect(session.items.filter((i) => i.kind === "ui")).toHaveLength(0);
});

it("reports run errors with their code", async () => {
  const errors: unknown[] = [];
  const session = new ChatSession({
    transport: new ReplayTransport(() => [{ type: "RUN_ERROR", message: "Assistant non configuré", code: "AGENT_NOT_CONFIGURED" }]),
    onRunError: (e) => errors.push(e),
  });
  await session.send("x");
  expect(errors).toEqual([{ message: "Assistant non configuré", code: "AGENT_NOT_CONFIGURED" }]);
});

describe("robustness against provider differences", () => {
  it("waits for createSurface when updates arrive first, and reports surfaces that never appear", async () => {
    const errors: string[] = [];
    const out = new ChatSession({
      transport: new ReplayTransport(() => [
        { type: "CUSTOM", name: "a2ui", value: { version: v, updateComponents: { surfaceId: "late", components: [{ id: "root", component: "Text", text: "ok" }] } } },
        { type: "CUSTOM", name: "a2ui", value: { version: v, createSurface: { surfaceId: "late", catalogId: A2UI_BASIC_CATALOG_ID } } },
        { type: "CUSTOM", name: "a2ui", value: { version: v, updateDataModel: { surfaceId: "ghost", value: {} } } },
      ]),
      onWarning: (w) => errors.push(w),
    });
    await out.send("x");
    await tick();
    expect(document.querySelector("[data-a2ui-surface]") ?? out.items.find((i) => i.kind === "ui")).toBeTruthy();
    expect(out.lastRun?.a2uiErrors).toEqual({ UNKNOWN_SURFACE: 1 });
    const ui = out.items.find((i) => i.kind === "ui") as { host: HTMLElement };
    expect(ui.host.textContent).toContain("ok");
  });

  it("accepts A2UI carried as a JSON string and flags invalid ones", async () => {
    const session = new ChatSession({
      transport: new ReplayTransport(() => [
        { type: "CUSTOM", name: "a2ui", value: JSON.stringify({ version: v, createSurface: { surfaceId: "s", catalogId: A2UI_BASIC_CATALOG_ID } }) },
        { type: "CUSTOM", name: "a2ui", value: "not json" },
      ]),
      onWarning: () => {},
    });
    await session.send("x");
    expect(session.items.some((i) => i.kind === "ui")).toBe(true);
    expect(session.lastRun?.a2uiErrors).toEqual({ INVALID_PAYLOAD: 1 });
  });

  it("closes dangling tools and texts, handles chunk events and duplicated starts", async () => {
    const session = new ChatSession({
      transport: new ReplayTransport(() => [
        { type: "TEXT_MESSAGE_START", messageId: "a" },
        { type: "TEXT_MESSAGE_START", messageId: "a" },
        { type: "TEXT_MESSAGE_CHUNK", messageId: "a", delta: "un" },
        { type: "TEXT_MESSAGE_START", messageId: "b" }, // "a" never ended
        { type: "TEXT_MESSAGE_CHUNK", delta: "deux" }, // no id: goes to "b"
        { type: "TOOL_CALL_CHUNK", toolCallId: "t", toolCallName: "search", delta: '{"q":' },
        { type: "TOOL_CALL_CHUNK", toolCallId: "t", delta: '"x"}' },
        { type: "TOOL_CALL_ARGS", toolCallId: "u", delta: { obj: 1 } as never },
        { type: "RUN_FINISHED" },
        { type: "SOMETHING_NEW" },
      ]),
    });
    await session.send("go");
    const texts = session.items.filter((i) => i.kind === "text") as { text: string; streaming: boolean }[];
    expect(texts.map((t) => t.text)).toEqual(["go", "un", "deux"]);
    expect(texts.every((t) => !t.streaming)).toBe(true);
    const tools = session.items.filter((i) => i.kind === "tool") as { name: string; done: boolean; args?: unknown }[];
    expect(tools.map((t) => [t.name, t.done])).toEqual([["search", true], ["tool", true]]);
    expect(tools[0].args).toEqual({ q: "x" });
    expect(session.lastRun).toMatchObject({ unclosedTools: 2, unclosedTexts: 1, ignored: 1, outcome: "finished" });
    expect(session.lastRun?.events.TEXT_MESSAGE_START).toBe(3);
    expect(session.lastRun?.firstEventMs).not.toBeNull();
  });

  it("gives up on a silent agent, even when the transport ignores the abort signal", async () => {
    vi.useFakeTimers();
    try {
      const errors: { message: string; code?: string }[] = [];
      let ended: string | undefined;
      const session = new ChatSession({
        idleTimeoutMs: 1000,
        transport: {
          async *run() {
            yield { type: "RUN_STARTED", threadId: "t", runId: "r" } as AgUiEvent;
            await new Promise(() => {}); // never answers, never aborts
          },
        },
        onRunError: (e) => errors.push(e),
        onRunEnd: (d) => (ended = d.outcome),
      });
      const done = session.send("hello");
      await vi.advanceTimersByTimeAsync(999);
      expect(session.running).toBe(true);
      await vi.advanceTimersByTimeAsync(2);
      await done;
      expect(session.running).toBe(false);
      expect(errors).toEqual([{ message: "L'agent ne répond plus (aucun événement depuis 1 s).", code: "IDLE_TIMEOUT" }]);
      expect(ended).toBe("idle-timeout");
      expect(session.items.at(-1)).toMatchObject({ kind: "error" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not time out while events keep coming, and keeps run diagnostics", async () => {
    const session = new ChatSession({ idleTimeoutMs: 50, transport: new ReplayTransport(() => textRun("m", "a", "b", "c"), 20) });
    await session.send("x");
    expect(session.lastRun?.outcome).toBe("finished");
    expect(session.items.some((i) => i.kind === "error")).toBe(false);
  });
});
