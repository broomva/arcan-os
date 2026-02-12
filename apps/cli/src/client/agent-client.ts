import type { AgentEvent, RunConfig } from '@agent-os/core';
import { type EventSourceParser, createParser } from 'eventsource-parser';
import { ofetch } from 'ofetch';

export class AgentClient {
  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<string[]> {
    // TODO: Implement list sessions endpoint in daemon
    // For now, we return a mock or expect the daemon to have it
    // return ofetch(`${this.baseUrl}/v1/sessions`);
    return [];
  }

  /**
   * Create a new run
   */
  async createRun(config: RunConfig): Promise<{ runId: string }> {
    return ofetch(`${this.baseUrl}/v1/runs`, {
      method: 'POST',
      body: config,
    });
  }

  /**
   * Connect to a run's event stream
   */
  async *connectToRun(
    runId: string,
  ): AsyncGenerator<AgentEvent, void, unknown> {
    const response = await fetch(`${this.baseUrl}/v1/runs/${runId}/stream`);

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let parser: EventSourceParser;
    const queue: AgentEvent[] = [];
    let resolveQueue: (() => void) | null = null;

    parser = createParser({
      onEvent(event) {
        try {
          const data = JSON.parse(event.data);
          queue.push(data);
          if (resolveQueue) {
            resolveQueue();
            resolveQueue = null;
          }
        } catch (e) {
          console.error('Failed to parse SSE data', e);
        }
      },
    });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        parser.feed(decoder.decode(value, { stream: true }));

        // Yield all queued events
        while (queue.length > 0) {
          // biome-ignore lint/style/noNonNullAssertion: length check guarantees non-empty
          yield queue.shift()!;
        }
      }
    } finally {
      reader.cancel();
    }
  }
}
