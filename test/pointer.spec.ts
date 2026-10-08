import { A2uiPathError, parsePointer, pointerToKey, pointerToPath } from "../src/a2ui/pointer";

it("parses RFC 6901 pointers with escapes", () => {
  expect(parsePointer("/")).toEqual([]);
  expect(parsePointer("/a~1b/c~0d/0")).toEqual(["a/b", "c~d", "0"]);
});

it("maps absolute pointers to Concorde paths", () => {
  expect(pointerToPath("/", "dp")).toBe("dp");
  expect(pointerToPath("/user/email", "dp")).toBe("dp.user.email");
  expect(pointerToPath("/items/2/name", "dp")).toBe("dp.items.2.name");
  expect(pointerToKey("/user/email")).toBe("user.email");
});

it("rejects what Concorde paths cannot express", () => {
  expect(() => pointerToPath("/a.b", "dp")).toThrow(A2uiPathError);
  expect(() => pointerToPath("name", "dp")).toThrow(/template/);
});
