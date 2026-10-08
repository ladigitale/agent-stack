import "@supersoniks/concorde/sdui";

it("renders a sonic-sdui in incremental mode", async () => {
  const el = document.createElement("sonic-sdui") as HTMLElement & {
    applyOp(op: unknown): void;
  };
  el.setAttribute("profile", "safe");
  el.setAttribute("partial", "");
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 0));
  el.applyOp({ op: "upsertNode", node: { nodeId: "root", tagName: "p", textContent: "hello" } });
  expect(el.querySelector('[data-sdui-node-id="root"]')?.textContent).toBe("hello");
});
