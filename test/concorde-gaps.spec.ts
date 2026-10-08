/**
 * Probes for behaviours of Concorde 5.1.0 that the A2UI adapter depends on.
 * They document the current state; see docs/concorde-gaps.md.
 */
import "@supersoniks/concorde/sdui";
import "@supersoniks/concorde/core/components/functional/value/value";
import { PublisherManager } from "@supersoniks/concorde/utils/PublisherProxy";

type Sdui = HTMLElement & { applyOp(op: unknown): void };
const tick = () => new Promise((r) => setTimeout(r, 0));

async function mount(): Promise<Sdui> {
  const el = document.createElement("sonic-sdui") as Sdui;
  el.setAttribute("profile", "safe");
  el.setAttribute("partial", "");
  document.body.appendChild(el);
  await tick();
  return el;
}

it("gap 3: child upserted before its parent leaves a stray root", async () => {
  const el = await mount();
  el.applyOp({ op: "upsertNode", node: { nodeId: "root", tagName: "section", childNodeIds: [] } });
  el.applyOp({ op: "upsertNode", node: { nodeId: "leaf", tagName: "p", textContent: "x" }, parentId: "box" });
  el.applyOp({
    op: "upsertNode",
    node: { nodeId: "box", tagName: "div", childNodeIds: ["leaf"] },
    parentId: "root",
  });
  const boxes = el.querySelectorAll('[data-sdui-node-id="box"]');
  const leaves = el.querySelectorAll('[data-sdui-node-id="leaf"]');
  console.log("boxes", boxes.length, "leaves", leaves.length, el.innerHTML);
  expect(boxes.length).toBeGreaterThanOrEqual(1);
});

it("gap 5: sonic-value renders data as HTML", async () => {
  PublisherManager.get("probe").set({ text: "<img src=x onerror=alert(1)>" });
  const el = await mount();
  el.applyOp({
    op: "upsertNode",
    node: { nodeId: "root", tagName: "sonic-value", attributes: { dataProvider: "probe", key: "text" } },
  });
  await tick();
  await (el.querySelector("sonic-value") as unknown as { updateComplete: Promise<unknown> })?.updateComplete;
  const html = el.querySelector("sonic-value")?.shadowRoot?.innerHTML ?? "";
  console.log("value shadow:", html);
  expect(html.includes("<img")).toBe(true);
});
