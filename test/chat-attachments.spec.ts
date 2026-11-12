import "../src/chat/sonic-chat";
import { ChatSession } from "../src/chat/session";
import { ReplayTransport } from "../src/chat/transport";
import { isLongPaste, textAttachment, toInputContent, utf8ToBase64, type ChatAttachment } from "../src/chat/attachments";
import type { RunAgentInput } from "../src/chat/ag-ui";

const tick = () => new Promise((r) => setTimeout(r, 0));
const answer = () => [
  { type: "TEXT_MESSAGE_START", messageId: "a", role: "assistant" },
  { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "ok" },
  { type: "TEXT_MESSAGE_END", messageId: "a" },
];
const image: ChatAttachment = { id: "i1", kind: "image", name: "photo.png", mimeType: "image/png", size: 4, data: "AAAA", previewUrl: "data:image/png;base64,AAAA" };

it("encodes text and attachments as AG-UI InputContent", () => {
  const parts = toInputContent("Regarde", [image, textAttachment("été\nligne 2")]);
  expect(parts[0]).toEqual({ type: "text", text: "Regarde" });
  expect(parts[1]).toEqual({ type: "image", source: { type: "data", value: "AAAA", mimeType: "image/png" }, metadata: { filename: "photo.png" } });
  expect(parts[2]).toMatchObject({ type: "document", source: { type: "data", mimeType: "text/plain", value: utf8ToBase64("été\nligne 2") }, metadata: { filename: "Texte collé", pasted: true } });
  expect(atob(utf8ToBase64("é")).length).toBe(2); // UTF-8
});

it("detects long pastes", () => {
  expect(isLongPaste("court")).toBe(false);
  expect(isLongPaste("x".repeat(2500))).toBe(true);
  expect(isLongPaste(Array(60).fill("l").join("\n"))).toBe(true);
});

it("sends attachments, shows them in the bubble, then lightens the history after a successful run", async () => {
  const inputs: RunAgentInput[] = [];
  const session = new ChatSession({ transport: new ReplayTransport((input) => (inputs.push(structuredClone(input)), answer())) });
  await session.send("Que vois-tu ?", [image]);
  const first = inputs[0].messages[0];
  expect(Array.isArray(first.content)).toBe(true);
  expect((first.content as { type: string }[]).map((p) => p.type)).toEqual(["text", "image"]);
  const bubble = session.items[0];
  expect(bubble.kind === "text" && bubble.attachments?.[0]).toMatchObject({ kind: "image", name: "photo.png" });

  await session.send("Et maintenant ?");
  const resent = inputs[1].messages[0];
  expect(typeof resent.content).toBe("string");
  expect(resent.content).toContain("Que vois-tu ?");
  expect(resent.content).toContain("[pièce jointe déjà envoyée : photo.png]");
});

it("keeps attachments in the history when the run fails (retry resends them)", async () => {
  const inputs: RunAgentInput[] = [];
  const session = new ChatSession({
    transport: new ReplayTransport((input) => (inputs.push(structuredClone(input)), [{ type: "RUN_ERROR", message: "boom" }])),
  });
  await session.send("Image", [image]);
  await session.retry();
  expect(Array.isArray(inputs[1].messages[0].content)).toBe(true);
});

it("turns a long paste into a collapsed attachment chip and sends it", async () => {
  const inputs: RunAgentInput[] = [];
  const el = document.createElement("sonic-chat");
  el.attachments = true;
  el.transport = new ReplayTransport((input) => (inputs.push(structuredClone(input)), answer()));
  document.body.appendChild(el);
  await el.updateComplete;
  const textarea = el.querySelector("textarea")!;
  const pasted = Array(80).fill("ligne de log").join("\n");
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { value: { files: [], getData: () => pasted } });
  textarea.dispatchEvent(event);
  await el.updateComplete;
  expect(event.defaultPrevented).toBe(true);
  expect(textarea.value).toBe("");
  const chip = el.querySelector("[data-chat-attachments] [data-chat-attachment]")!;
  expect(chip.textContent).toContain("Texte collé");
  expect(chip.textContent).toContain("80 lignes");
  expect(chip.querySelector("details pre")!.textContent).toContain("ligne de log");
  // Envoyable sans texte.
  el.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await tick();
  await el.updateComplete;
  const parts = inputs[0].messages[0].content as { type: string; metadata?: { filename?: string } }[];
  expect(parts).toHaveLength(1);
  expect(parts[0]).toMatchObject({ type: "document", metadata: { filename: "Texte collé" } });
  expect(el.querySelector("form [data-chat-attachments]")).toBeNull();
  expect(el.querySelector("[data-chat-msg=user] [data-chat-attachment]")).not.toBeNull();
  el.remove();
});

it("keeps a short paste in the textarea", async () => {
  const el = document.createElement("sonic-chat");
  el.attachments = true;
  el.transport = new ReplayTransport(() => []);
  document.body.appendChild(el);
  await el.updateComplete;
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { value: { files: [], getData: () => "court" } });
  el.querySelector("textarea")!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  el.remove();
});

it("adds and removes picked text files", async () => {
  const el = document.createElement("sonic-chat");
  el.attachments = true;
  el.transport = new ReplayTransport(() => []);
  document.body.appendChild(el);
  await el.updateComplete;
  await el.addFiles([new File(["a,b\n1,2"], "data.csv", { type: "text/csv" })]);
  await el.updateComplete;
  expect(el.pending).toHaveLength(1);
  expect(el.pending[0]).toMatchObject({ kind: "text", name: "data.csv", text: "a,b\n1,2" });
  await el.addFiles([new File(["x"], "archive.zip", { type: "application/zip" })]);
  await el.updateComplete;
  expect(el.querySelector("[data-chat-attach-error]")!.textContent).toContain("format non pris en charge");
  (el.querySelector("[data-chat-attachment] button") as HTMLButtonElement).click();
  await el.updateComplete;
  expect(el.pending).toHaveLength(0);
  el.remove();
});

it("shows tool steps with parameters, result and a collapsible group", async () => {
  const el = document.createElement("sonic-chat");
  el.transport = new ReplayTransport(() => [
    { type: "TOOL_CALL_START", toolCallId: "t1", toolCallName: "find_icons" },
    { type: "TOOL_CALL_ARGS", toolCallId: "t1", delta: '{"query":"maison"}' },
    { type: "TOOL_CALL_END", toolCallId: "t1" },
    { type: "TOOL_CALL_RESULT", messageId: "r1", toolCallId: "t1", content: '{"icons":["home"]}' },
    { type: "TOOL_CALL_START", toolCallId: "t2", toolCallName: "preview_artifact" },
    { type: "TOOL_CALL_END", toolCallId: "t2" },
    ...answer(),
  ]);
  document.body.appendChild(el);
  await el.updateComplete;
  await el.send("Fais une page");
  await el.updateComplete;
  const group = el.querySelector("details[data-chat-steps]") as HTMLDetailsElement;
  expect(group).not.toBeNull();
  expect(group.querySelector("summary")!.textContent).toContain("2 étapes");
  expect(group.open).toBe(false); // run terminé : replié
  const step = group.querySelector("details[data-chat-tool]")!;
  const detail = step.querySelector("[data-chat-tool-detail]")!.textContent!;
  expect(detail).toContain('"query": "maison"');
  expect(detail).toContain('"home"');
  // Choix de l'utilisateur gardé d'un rendu à l'autre.
  group.open = true;
  group.dispatchEvent(new Event("toggle"));
  el.requestUpdate();
  await el.updateComplete;
  expect((el.querySelector("details[data-chat-steps]") as HTMLDetailsElement).open).toBe(true);
  el.remove();
});
