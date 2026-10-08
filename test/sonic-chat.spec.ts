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
