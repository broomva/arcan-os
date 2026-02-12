import type { AgentEvent, RunConfig } from '@arcan-os/core';
import { createParser, type EventSourceParser } from 'eventsource-parser';
import { ofetch } from 'ofetch';

export class AgentClient {
  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:4200') {
    this.baseUrl = baseUrl;
  }

  /**
   * List all session IDs.
   */
  async listSessions(): Promise<string[]> {
    return ofetch(`${this.baseUrl}/v1/sessions/list`);
  }

  /**
   * Get materialized session state (snapshot + pending events + pending approvals).
   */
  async getSessionState(sessionId: string): Promise<{
    sessionId: string;
    snapshot: unknown;
    pendingEvents: AgentEvent[];
    pendingApprovals: unknown[];
    ts: number;
  }> {
    return ofetch(`${this.baseUrl}/v1/sessions/${sessionId}/state`);
  }

  /**
   * Create a new run.
   */
  async createRun(config: RunConfig): Promise<{ runId: string }> {
    return ofetch(`${this.baseUrl}/v1/runs`, {
      method: 'POST',
      body: config,
    });
  }

  /**
   * Resolve a pending approval (approve or deny).
   */
  async resolveApproval(
    approvalId: string,
    decision: 'approve' | 'deny',
    reason?: string,
  ): Promise<{ status: string; approvalId: string }> {
    return ofetch(`${this.baseUrl}/v1/approvals/${approvalId}`, {
      method: 'POST',
      body: { decision, reason },
    });
  }

  /**
   * Connect to a run's event stream.
   */
  async *connectToRun(
    runId: string,
  ): AsyncGenerator<AgentEvent, void, unknown> {
    const response = await fetch(`${this.baseUrl}/v1/runs/${runId}/events`);

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
