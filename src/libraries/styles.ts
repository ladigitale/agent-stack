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
:where([data-chat="answer"]) { display: flex; flex-direction: column; gap: var(--a2ui-gap, 0.75rem); white-space: pre-wrap; }
:where([data-chat="short-form"]) { display: flex; flex-direction: column; gap: var(--a2ui-gap, 0.75rem); }
`;

const STYLE_ID = "agent-stack-styles";

export function injectAgentStackStyles(doc: Document = document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = agentStackCss;
  doc.head.appendChild(style);
}
