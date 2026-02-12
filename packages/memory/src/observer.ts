import type {
  AgentEvent,
  Observation,
  OutputMessagePayload,
  RunFailedPayload,
  RunStartedPayload,
  ToolCallPayload,
  ToolResultPayload,
} from '@agent-os/core';
import { generateId, now } from '@agent-os/core';
import type { LanguageModel } from 'ai';
import { generateText, tool } from 'ai';
import { z } from 'zod';

export class Observer {
  constructor(private model: LanguageModel) {}

  /**
   * Analyze a stream of events and extract observations.
   */
  async observe(events: AgentEvent[]): Promise<Observation[]> {
    if (events.length === 0) return [];

    const transcript = this.eventsToTranscript(events);
    if (!transcript.trim()) return [];

    const result = await generateText({
      model: this.model,
      prompt: `Analyze the following agent execution transcript and extract key observations.
Focus on:
- User intent and requirements (Facts)
- meaningful actions taken by the agent (Actions)
- Outcomes of tools and tasks (Outcomes)

Ignore transient chatter or intermediate thinking unless critical.

TRANSCRIPT:
${transcript}`,
      tools: {
        recordObservations: tool({
          description: 'Record extracted observations from the transcript',
          inputSchema: z.object({
            observations: z.array(
              z.object({
                type: z.enum(['fact', 'action', 'outcome']),
                content: z
                  .string()
                  .describe('Concise description of the observation'),
              }),
            ),
          }),
        }),
      },
      toolChoice: 'required', // Force the model to use the tool
    });

    // Extract tool calls
    const toolCalls = result.toolCalls;
    if (!toolCalls || toolCalls.length === 0) return [];

    const obsCall = toolCalls.find(
      (tc) => tc.toolName === 'recordObservations',
    );
    if (!obsCall) return [];

    const args = obsCall.input as {
      observations: Array<{
        type: 'fact' | 'action' | 'outcome';
        content: string;
      }>;
    };

    const timestamp = now();

    return args.observations.map((o) => ({
      id: generateId(),
      ts: timestamp,
      type: o.type,
      content: o.content,
      sourceEventIds: events.map((e) => e.eventId),
    }));
  }

  private eventsToTranscript(events: AgentEvent[]): string {
    let transcript = '';

    // Simple projection
    // We assume events are sorted by seq
    for (const event of events) {
      switch (event.type) {
        case 'run.started': {
          const p = event.payload as RunStartedPayload;
          transcript += `[SYSTEM] Run started. Prompt: "${p.prompt}"\n`;
          break;
        }
        case 'output.message': {
          const p = event.payload as OutputMessagePayload;
          transcript += `[AGENT] ${p.content}\n`;
          break;
        }
        case 'tool.call': {
          const p = event.payload as ToolCallPayload;
          transcript += `[TOOL_CALL] ${p.toolId} args=${JSON.stringify(p.args)}\n`;
          break;
        }
        case 'tool.result': {
          const p = event.payload as ToolResultPayload;
          let resultStr = JSON.stringify(p.result);
          if (resultStr.length > 500)
            resultStr = `${resultStr.slice(0, 500)}... (truncated)`;
          transcript += `[TOOL_RESULT] ${resultStr}\n`;
          break;
        }
        case 'run.completed':
          transcript += '[SYSTEM] Run completed.\n';
          break;
        case 'run.failed': {
          const p = event.payload as RunFailedPayload;
          transcript += `[SYSTEM] Run failed: ${p.error}\n`;
          break;
        }
        default:
          break;
      }
    }
    return transcript;
  }
}
