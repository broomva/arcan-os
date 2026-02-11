import { generateText, tool } from 'ai';
import { z } from 'zod';
import type { LanguageModel } from 'ai';
import { generateId, now } from '@agent-os/core';
import type { AgentEvent, Observation } from '@agent-os/core';

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
          parameters: z.object({
            observations: z.array(
              z.object({
                type: z.enum(['fact', 'action', 'outcome']),
                content: z.string().describe('Concise description of the observation'),
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

    const obsCall = toolCalls.find((tc) => tc.toolName === 'recordObservations');
    if (!obsCall) return [];

    const args = obsCall.args as { observations: Array<{ type: 'fact' | 'action' | 'outcome'; content: string }> };
    
    const timestamp = now();
    
    return args.observations.map((o) => ({
      id: generateId('obs'),
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
      if (event.type === 'run.started') {
        const p = event.payload as any;
        transcript += `[SYSTEM] Run started. Prompt: "${p.prompt}"\n`;
      } else if (event.type === 'output.message') {
        const p = event.payload as any;
        transcript += `[AGENT] ${p.content}\n`;
      } else if (event.type === 'output.delta') {
         // Skip deltas in favor of full messages if available, or accumulate them
         // For simplistic memory, we might just look at tool calls/results and initial prompts
         // If we only have deltas, we might miss the full text unless we reassemble.
         // Let's assume for now we mainly care about inputs and tool I/O
      } else if (event.type === 'tool.call') {
        const p = event.payload as any;
        transcript += `[TOOL_CALL] ${p.toolId} args=${JSON.stringify(p.args)}\n`;
      } else if (event.type === 'tool.result') {
        const p = event.payload as any;
        // Truncate large results
        let resultStr = JSON.stringify(p.result);
        if (resultStr.length > 500) resultStr = resultStr.slice(0, 500) + '... (truncated)';
        transcript += `[TOOL_RESULT] ${resultStr}\n`;
      } else if (event.type === 'run.completed') {
        transcript += `[SYSTEM] Run completed.\n`;
      } else if (event.type === 'run.failed') {
        const p = event.payload as any;
        transcript += `[SYSTEM] Run failed: ${p.error}\n`;
      }
    }
    return transcript;
  }
}
