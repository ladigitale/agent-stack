/**
 * Conversion between A2UI JSON Pointers (RFC 6901) and Concorde publisher paths
 * (dot notation: "provider.a.b.0").
 */

export class A2uiPathError extends Error {
  constructor(message: string, readonly pointer: string) {
    super(message);
    this.name = "A2uiPathError";
  }
}

/** Splits a JSON Pointer into unescaped segments ("" and "/" → []). */
export function parsePointer(pointer: string): string[] {
  if (pointer === "" || pointer === "/") return [];
  const body = pointer.startsWith("/") ? pointer.slice(1) : pointer;
  return body.split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * Converts an absolute JSON Pointer to a Concorde path rooted at `dataProvider`.
 * Relative pointers (template scopes) are not supported yet.
 *
 * Concorde paths use "." as separator, so a segment containing "." cannot be
 * represented and is rejected rather than silently mis-addressed.
 */
export function pointerToPath(pointer: string, dataProvider: string): string {
  return [dataProvider, ...pointerSegments(pointer)].join(".");
}

/** Same as `pointerToPath` but relative to the provider (for `name` on form fields). */
export function pointerToKey(pointer: string): string {
  return pointerSegments(pointer).join(".");
}

function pointerSegments(pointer: string): string[] {
  if (pointer !== "" && !pointer.startsWith("/")) {
    throw new A2uiPathError(
      `Relative path "${pointer}" is only valid inside a list template, which is not supported yet`,
      pointer
    );
  }
  const segments = parsePointer(pointer);
  for (const s of segments) {
    if (s === "" || s.includes(".")) {
      throw new A2uiPathError(
        `Path segment "${s}" cannot be mapped to a Concorde path (empty or contains ".")`,
        pointer
      );
    }
  }
  return segments;
}
