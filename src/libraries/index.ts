import type { SDUINode } from "@supersoniks/concorde/core/components/functional/sdui/types";
import a2uiBasicJson from "./a2ui-basic.json";
import chatJson from "./chat.json";

/** SDUI library implementing the A2UI v0.9 basic catalog (keys `a2ui:<Component>[.<variant>]`). */
export const a2uiBasicLibrary = a2uiBasicJson as Record<string, SDUINode>;

/** SDUI library of chat templates (keys `chat:<template>`), for agents emitting SDUI directly. */
export const chatLibrary = chatJson as Record<string, SDUINode>;

/** Both libraries merged, ready for `descriptor.library`. */
export const agentStackLibrary: Record<string, SDUINode> = { ...a2uiBasicLibrary, ...chatLibrary };

export { agentStackCss, injectAgentStackStyles } from "./styles";
