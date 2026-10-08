import type { AgUiEvent, RunAgentInput } from "./ag-ui";
import { readSseData } from "./sse";

/** Anything that can run an agent and stream AG-UI events back. */
export interface AgentTransport {
  run(input: RunAgentInput, signal?: AbortSignal): AsyncIterable<AgUiEvent>;
}

export type HttpTransportOptions = {
  url: string;
  headers?: Record<string, string>;
  /** Defaults to "same-origin" so a PHP session cookie is sent. */
  credentials?: RequestCredentials;
};

/** AG-UI over HTTP: POST the RunAgentInput as JSON, read an SSE stream of events. */
export class HttpAgUiTransport implements AgentTransport {
  constructor(private readonly options: HttpTransportOptions) {}

  async *run(input: RunAgentInput, signal?: AbortSignal): AsyncIterable<AgUiEvent> {
    const response = await fetch(this.options.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...this.options.headers },
      credentials: this.options.credentials ?? "same-origin",
      body: JSON.stringify(input),
      signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Agent endpoint answered ${response.status} ${response.statusText}`);
    }
    for await (const data of readSseData(response.body)) {
      if (data === "[DONE]") return;
      yield JSON.parse(data) as AgUiEvent;
    }
  }
}

/**
 * Replays scripted events, for demos and tests. `script` receives the run input
 * (last message, forwarded action…) and returns the events to emit.
 */
export class ReplayTransport implements AgentTransport {
  constructor(
    private readonly script: (input: RunAgentInput) => AgUiEvent[],
    private readonly delayMs = 0
  ) {}

  async *run(input: RunAgentInput, signal?: AbortSignal): AsyncIterable<AgUiEvent> {
    for (const event of this.script(input)) {
      if (signal?.aborted) return;
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      yield event;
    }
  }
}
