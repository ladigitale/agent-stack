import "@supersoniks/concorde/sdui";
import "@supersoniks/concorde/button";
import "@supersoniks/concorde/input";
import { findShadowedAccessors } from "@supersoniks/concorde/core/utils/shadowedAccessors";
import { defineA2uiElements } from "../src/a2ui";
import "../src/chat";

/**
 * Lit and Concorde install reactive accessors on the prototype (decorators or
 * `static properties`). A class field compiled with [[Define]] semantics becomes
 * an own property that hides the accessor: no re-render, no store write. The
 * transform options of vitest.config.ts / vite.config.ts prevent it; this test
 * fails if they stop being applied (to our sources or to Concorde's).
 */
const registered: string[] = [];
const define = customElements.define.bind(customElements);
customElements.define = (name, ctor, options) => {
  registered.push(name);
  define(name, ctor, options);
};
defineA2uiElements();
customElements.define = define;

const tags = ["sonic-chat", "sonic-sdui", "sonic-button", "sonic-input", ...registered];

it.each(tags)("<%s> keeps its reactive accessors", (tag) => {
  expect(customElements.get(tag)).toBeDefined();
  expect(findShadowedAccessors(document.createElement(tag))).toEqual([]);
});
