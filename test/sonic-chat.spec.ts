import "../src/chat/sonic-chat";
import { ReplayTransport } from "../src/chat/transport";

const tick = () => new Promise((r) => setTimeout(r, 0));

it("sends the draft and renders the streamed answer as plain text", async () => {
  const el = document.createElement("sonic-chat");
  el.transport = new ReplayTransport(() => [
    { type: "TEXT_MESSAGE_START", messageId: "a", role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "<b>pas du HTML</b>" },
    { type: "TEXT_MESSAGE_END", messageId: "a" },
  ]);
  document.body.appendChild(el);
  await el.updateComplete;
  const textarea = el.querySelector("textarea")!;
  textarea.value = "Bonjour";
  textarea.dispatchEvent(new Event("input"));
  el.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await tick();
  await el.updateComplete;
  const msgs = [...el.querySelectorAll("[data-chat-msg]")].map((m) => [m.getAttribute("data-chat-msg"), m.textContent]);
  expect(msgs).toEqual([
    ["user", "Bonjour"],
    ["assistant", "<b>pas du HTML</b>"],
  ]);
  expect(el.querySelector("[data-chat-msg] b")).toBeNull();
  expect(textarea.value).toBe("");
});

it("injects its styles into the shadow root that hosts it", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const el = document.createElement("sonic-chat");
  el.transport = new ReplayTransport(() => []);
  shadow.appendChild(el);
  await el.updateComplete;
  expect(shadow.getElementById("sonic-chat-styles")).not.toBeNull();
  expect(shadow.getElementById("agent-stack-styles")).not.toBeNull();
});

it("keeps the conversation when headers or forwardedProps change", async () => {
  const el = document.createElement("sonic-chat");
  el.transport = new ReplayTransport(() => [
    { type: "TEXT_MESSAGE_START", messageId: "a", role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "ok" },
    { type: "TEXT_MESSAGE_END", messageId: "a" },
  ]);
  document.body.appendChild(el);
  await el.updateComplete;
  await el.send("hello");
  el.headers = { Authorization: "Bearer x" };
  el.forwardedProps = { artifact: { slug: "abc" } };
  await el.updateComplete;
  expect(el.querySelectorAll("[data-chat-msg]")).toHaveLength(2);
});

it("shows what the agent is doing while it works", async () => {
  const el = document.createElement("sonic-chat");
  let release!: () => void;
  let finish!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const end = new Promise<void>((r) => (finish = r));
  el.toolLabels = {
    start_from_kit: (args, done) => (done ? "Kit appliqué" : `Création depuis le kit « ${args?.kit ?? "…"} »`),
    find_icons: "Recherche d'icônes",
  };
  el.transport = {
    async *run() {
      yield { type: "RUN_STARTED", threadId: "t", runId: "r" };
      yield { type: "TOOL_CALL_START", toolCallId: "c1", toolCallName: "start_from_kit" };
      yield { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: '{"kit":"qu' };
      yield { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: 'iz"}' };
      await gate;
      yield { type: "TOOL_CALL_END", toolCallId: "c1" };
      yield { type: "CUSTOM", name: "status", value: { label: "Contrôle du document" } };
      await end;
      yield { type: "RUN_FINISHED", threadId: "t", runId: "r" };
    },
  };
  document.body.appendChild(el);
  await el.updateComplete;
  const status = () => el.querySelector("[data-chat-status]");
  const sent = el.send("go");
  await el.updateComplete;
  expect(status()?.getAttribute("data-phase")).toBe("sending");
  await tick();
  await el.updateComplete;
  expect(status()?.textContent).toContain("Création depuis le kit « quiz »…");
  expect(el.querySelector("[data-chat-status] [data-chat-spinner]")).not.toBeNull();
  release();
  await tick();
  await el.updateComplete;
  expect(el.querySelector("[data-chat-tool]")?.textContent).toContain("Kit appliqué");
  expect(el.querySelector("[data-chat-tool] [data-chat-tool-done]")).not.toBeNull();
  expect(status()?.textContent).toContain("Contrôle du document");
  finish();
  await sent;
  await el.updateComplete;
  expect(status()).toBeNull();
});

it("shows a thinking state between events", async () => {
  const el = document.createElement("sonic-chat");
  el.transport = {
    async *run() {
      yield { type: "RUN_STARTED", threadId: "t", runId: "r" };
      await new Promise((r) => setTimeout(r, 20));
    },
  };
  document.body.appendChild(el);
  await el.updateComplete;
  const sent = el.send("hi");
  await tick();
  await el.updateComplete;
  expect(el.querySelector("[data-chat-status]")?.getAttribute("data-phase")).toBe("thinking");
  await sent;
});

it("restores a past conversation and carries on in the same thread, with the text history", async () => {
  const inputs: any[] = [];
  const el = document.createElement("sonic-chat");
  el.threadId = "thread-42";
  el.restoreEntries = [
    { role: "user", text: "Fais un quiz" },
    { role: "assistant", id: "m1", text: "Voilà." },
    { event: { type: "TOOL_CALL_START", toolCallId: "c1", toolCallName: "preview_artifact" } },
  ];
  el.transport = {
    async *run(input: any) {
      inputs.push(input);
      yield { type: "RUN_FINISHED" };
    },
  } as any;
  document.body.appendChild(el);
  await el.updateComplete;
  expect(el.session!.threadId).toBe("thread-42");
  expect(el.session!.items.map((i) => i.kind)).toEqual(["text", "text", "tool"]);
  expect((el.session!.items[2] as any).done).toBe(true);
  expect(el.session!.status).toBeNull();
  await el.send("Plus dur");
  expect(inputs[0].threadId).toBe("thread-42");
  expect(inputs[0].messages.map((m: any) => [m.role, m.content])).toEqual([
    ["user", "Fais un quiz"],
    ["assistant", "Voilà."],
    ["user", "Plus dur"],
  ]);
  // Another thread: a fresh session.
  el.threadId = "other";
  el.restoreEntries = undefined;
  await el.updateComplete;
  expect(el.session!.threadId).toBe("other");
  expect(el.session!.items).toEqual([]);
});
