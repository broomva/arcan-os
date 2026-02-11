/**
 * @agent-os/context — Message History
 *
 * Projects event stream into conversation messages for the engine.
 * Converts AgentEvents → EngineMessage[] for the LLM.
 */

import type { AgentEvent, EngineMessage } from '@agent-os/core';

// ---------------------------------------------------------------------------
// Message History Projection
// ---------------------------------------------------------------------------

/**
 * Project a stream of AgentEvents into a conversation message history.
 *
 * Maps:
 *   - output.delta → accumulates into assistant message
 *   - output.message → assistant message
 *   - tool.call → assistant message with tool call
 *   - tool.result → tool message with result
 *   - run.started → user message (from config prompt)
 */
export function projectMessages(events: AgentEvent[]): EngineMessage[] {
  const messages: EngineMessage[] = [];
  let currentAssistant: { content: string } | null = null;

  for (const event of events) {
    switch (event.type) {
      case 'output.delta': {
        // Accumulate text deltas into an assistant message
        if (!currentAssistant) {
          currentAssistant = { content: '' };
        }
        const payload = event.payload as { text: string };
        currentAssistant.content += payload.text;
        break;
      }

      case 'output.message': {
        // Flush any accumulated deltas first
        if (currentAssistant) {
          messages.push({ role: 'assistant', content: currentAssistant.content });
          currentAssistant = null;
        }
        const payload = event.payload as { text: string };
        messages.push({ role: 'assistant', content: payload.text });
        break;
      }

      case 'tool.call': {
        // Flush accumulated deltas
        if (currentAssistant) {
          messages.push({ role: 'assistant', content: currentAssistant.content });
          currentAssistant = null;
        }
        const payload = event.payload as {
          callId: string;
          toolId: string;
          args: Record<string, unknown>;
        };
        messages.push({
          role: 'assistant',
          content: `[Tool Call: ${payload.toolId}(${JSON.stringify(payload.args)})]`,
          toolCallId: payload.callId,
          toolName: payload.toolId,
        });
        break;
      }

      case 'tool.result': {
        const payload = event.payload as {
          callId: string;
          toolId: string;
          result: unknown;
        };
        messages.push({
          role: 'tool',
          content:
            typeof payload.result === 'string'
              ? payload.result
              : JSON.stringify(payload.result),
          toolCallId: payload.callId,
          toolName: payload.toolId,
        });
        break;
      }

      // Skip non-message events (run lifecycle, engine instrumentation, etc.)
      default:
        break;
    }
  }

  // Flush remaining accumulated deltas
  if (currentAssistant) {
    messages.push({ role: 'assistant', content: currentAssistant.content });
  }

  return messages;
}
