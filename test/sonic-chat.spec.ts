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

function mount(transport: ConstructorParameters<typeof Object>[0] = undefined) {
  const el = document.createElement("sonic-chat");
  el.transport = transport as never;
  document.body.appendChild(el);
  return el;
}
const type = (el: HTMLElement, text: string) => {
  const ta = el.querySelector("textarea")!;
  ta.value = text;
  ta.dispatchEvent(new Event("input"));
  return ta;
};
const enter = (ta: HTMLElement, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init });
  ta.dispatchEvent(e);
  return e;
};

it("shows an empty state, a focusable labelled log and a disabled send button", async () => {
  const el = mount(new ReplayTransport(() => []));
  el.emptyText = "Posez une question";
  await el.updateComplete;
  expect(el.querySelector("[data-chat-empty]")?.textContent).toBe("Posez une question");
  const log = el.querySelector("[data-chat-log]")!;
  expect(log.getAttribute("tabindex")).toBe("0");
  expect(log.getAttribute("aria-label")).toBe("Conversation");
  expect(el.querySelector("form sonic-button")?.hasAttribute("disabled")).toBe(true);
  type(el, "salut");
  await el.updateComplete;
  expect(el.querySelector("form sonic-button")?.hasAttribute("disabled")).toBe(false);
});

it("Enter sends, Shift+Enter and IME composition do not, blank drafts are ignored", async () => {
  let runs = 0;
  const el = mount(new ReplayTransport(() => (runs++, [])));
  await el.updateComplete;
  const ta = type(el, "   ");
  expect(enter(ta).defaultPrevented).toBe(true);
  await tick();
  expect(runs).toBe(0);
  type(el, "bonjour");
  enter(ta, { shiftKey: true });
  enter(ta, { isComposing: true });
  await tick();
  expect(runs).toBe(0);
  enter(ta);
  await tick();
  expect(runs).toBe(1);
});

it("offers a retry after a failed run and replays it", async () => {
  let n = 0;
  const el = mount(
    new ReplayTransport(() => (n++ === 0 ? [{ type: "RUN_ERROR", message: "boom" }] : [{ type: "RUN_FINISHED" }]))
  );
  await el.updateComplete;
  await el.send("hello");
  await el.updateComplete;
  const err = el.querySelector("[data-chat-error]")!;
  expect(err.getAttribute("role")).toBe("alert");
  const retry = [...err.querySelectorAll("sonic-button")].find((b) => b.textContent?.includes("Réessayer"))!;
  (retry as HTMLElement).click();
  await tick();
  await el.updateComplete;
  expect(n).toBe(2);
});

it("flags data-running on the element while a run is in progress", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const el = mount({
    async *run() {
      await gate;
    },
  });
  await el.updateComplete;
  const p = el.send("go");
  await el.updateComplete;
  expect(el.hasAttribute("data-running")).toBe(true);
  release();
  await p;
  await el.updateComplete;
  expect(el.hasAttribute("data-running")).toBe(false);
});
