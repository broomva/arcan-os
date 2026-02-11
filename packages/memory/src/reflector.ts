import { generateId, now } from '@agent-os/core';
import type { Observation, Reflection } from '@agent-os/core';
import { generateText, tool } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';

export class Reflector {
  constructor(private model: LanguageModel) {}

  /**
   * Synthesize high-level reflections from a list of observations.
   */
  async reflect(observations: Observation[]): Promise<Reflection[]> {
    if (observations.length === 0) return [];

    const observationText = observations
      .map((o) => `- [${o.type}] ${o.content}`)
      .join('\n');

    const result = await generateText({
      model: this.model,
      prompt: `Analyze the following list of observations and synthesize high-level reflections.
Look for recurring patterns, user preferences, long-term project goals, and important architectural decisions.

Reflections should be generalized and enduring.

OBSERVATIONS:
${observationText}`,
      tools: {
        recordReflections: tool({
          description: 'Record synthesized reflections from observations',
          parameters: z.object({
            reflections: z.array(
              z.object({
                topic: z
                  .string()
                  .describe(
                    'The subject of the reflection (e.g., "User Preference", "Project Architecture")',
                  ),
                content: z.string().describe('The synthesized insight'),
                frequency: z
                  .number()
                  .describe('How often this pattern was observed (1-10 scale)'),
              }),
            ),
          }),
        }),
      },
      toolChoice: 'required',
    });

    const toolCalls = result.toolCalls;
    if (!toolCalls || toolCalls.length === 0) return [];

    const refCall = toolCalls.find((tc) => tc.toolName === 'recordReflections');
    if (!refCall) return [];

    const args = refCall.args as {
      reflections: Array<{ topic: string; content: string; frequency: number }>;
    };

    const timestamp = now();

    return args.reflections.map((r) => ({
      id: generateId(),
      ts: timestamp,
      topic: r.topic,
      content: r.content,
      frequency: r.frequency,
    }));
  }
}
