/**
 * Layout rules for the `a2ui-basic` and `chat` libraries. Selectors use
 * `:where()` (zero specificity) so any theme can override them.
 * Injected once per document by `injectAgentStackStyles()`.
 */
export const agentStackCss = `
:where([data-a2ui="Row"]) { display: flex; flex-direction: row; flex-wrap: wrap; gap: var(--a2ui-gap, 0.75rem); }
:where([data-a2ui="Column"], [data-a2ui="List"]) { display: flex; flex-direction: column; gap: var(--a2ui-gap, 0.75rem); }
:where([data-a2ui="List"][data-a2ui-direction="horizontal"]) { flex-direction: row; }
:where([data-a2ui-justify="start"]) { justify-content: flex-start; }
:where([data-a2ui-justify="center"]) { justify-content: center; }
:where([data-a2ui-justify="end"]) { justify-content: flex-end; }
:where([data-a2ui-justify="spaceBetween"]) { justify-content: space-between; }
:where([data-a2ui-justify="spaceAround"]) { justify-content: space-around; }
:where([data-a2ui-justify="spaceEvenly"]) { justify-content: space-evenly; }
:where([data-a2ui-justify="stretch"]) { justify-content: stretch; }
:where([data-a2ui-align="start"]) { align-items: flex-start; }
:where([data-a2ui-align="center"]) { align-items: center; }
:where([data-a2ui-align="end"]) { align-items: flex-end; }
:where([data-a2ui-align="stretch"]) { align-items: stretch; }
:where([data-a2ui="Text"]) { margin: 0; }
:where(h1[data-a2ui="Text"]) { font-size: var(--a2ui-h1, 2em); font-weight: 700; line-height: 1.2; }
:where(h2[data-a2ui="Text"]) { font-size: var(--a2ui-h2, 1.5em); font-weight: 700; line-height: 1.25; }
:where(h3[data-a2ui="Text"]) { font-size: var(--a2ui-h3, 1.25em); font-weight: 600; line-height: 1.3; }
:where(h4[data-a2ui="Text"]) { font-size: var(--a2ui-h4, 1.1em); font-weight: 600; }
:where(h5[data-a2ui="Text"]) { font-size: var(--a2ui-h5, 1em); font-weight: 600; }
:where(small[data-a2ui="Text"]) { font-size: 0.85em; opacity: 0.8; }
:where([data-chat="answer"]) { display: flex; flex-direction: column; gap: var(--a2ui-gap, 0.75rem); white-space: pre-wrap; }
:where([data-chat="short-form"]) { display: flex; flex-direction: column; gap: var(--a2ui-gap, 0.75rem); }
`;

const STYLE_ID = "agent-stack-styles";

/**
 * Injects the layout CSS once per target. Pass the ShadowRoot when the
 * surfaces are rendered inside a shadow tree (document styles do not pierce it).
 */
export function injectAgentStackStyles(target: Document | ShadowRoot = document) {
  if (target.getElementById(STYLE_ID)) return;
  const doc = target instanceof Document ? target : target.ownerDocument;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = agentStackCss;
  if (target instanceof Document) target.head.appendChild(style);
  else target.appendChild(style);
}
