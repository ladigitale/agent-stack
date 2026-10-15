/**
 * Layout rules for the `a2ui-basic` and `chat` libraries. Selectors use
 * `:where()` (zero specificity) so any theme can override them, except the
 * heading sizes: they must beat CSS resets such as Tailwind's preflight
 * (`h1…h6 { font-size: inherit }`), so they keep the attribute's specificity.
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
:where([data-a2ui-choices]) { display: flex; flex-direction: column; gap: var(--a2ui-choice-gap, 0.5rem); }
:where([data-a2ui-choices="chips"]) { flex-direction: row; flex-wrap: wrap; }
:where([data-a2ui="Text"]) { margin: 0; }
h1[data-a2ui="Text"] { font-size: var(--a2ui-h1, 1.6em); font-weight: 700; line-height: 1.2; text-wrap: balance; }
h2[data-a2ui="Text"] { font-size: var(--a2ui-h2, 1.4em); font-weight: 700; line-height: 1.25; text-wrap: balance; }
h3[data-a2ui="Text"] { font-size: var(--a2ui-h3, 1.2em); font-weight: 600; line-height: 1.3; text-wrap: balance; }
h4[data-a2ui="Text"] { font-size: var(--a2ui-h4, 1.1em); font-weight: 600; line-height: 1.35; }
h5[data-a2ui="Text"] { font-size: var(--a2ui-h5, 1em); font-weight: 600; line-height: 1.4; }
/* More air above a heading than below: it belongs to what follows. */
:where(h1, h2, h3, h4, h5)[data-a2ui="Text"]:not(:first-child) { margin-block-start: var(--a2ui-heading-gap, 0.5rem); }
small[data-a2ui="Text"] { font-size: 0.85em; color: color-mix(in srgb, currentColor 72%, transparent); }
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
