/**
 * @agent-os/engine-adapter — AI SDK Engine
 *
 * Wraps the Vercel AI SDK streamText to produce canonical AgentEvents.
 * Implements the AgentEngine interface from @agent-os/core.
 *
 * This is the anti-corruption layer between the AI SDK and Agent OS.
 * (V1 spec §12, unified_state_analysis §3)
 */

import { streamText, type CoreTool, type StreamTextResult } from 'ai';
import type {
  AgentEngine,
  AgentEvent,
  EngineRunRequest,
  EngineMessage,
  ToolHandler,
  OutputDeltaPayload,
  ToolCallPayload,
  ToolResultPayload,
  EngineRequestPayload,
  EngineResponsePayload,
} from '@agent-os/core';
import { generateId, now } from '@agent-os/core';
import type { ToolKernel } from '@agent-os/tool-kernel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiSdkEngineConfig {
  model: Parameters<typeof streamText>[0]['model'];
  toolKernel: ToolKernel;
  /** Max steps for the ToolLoopAgent */
  maxSteps?: number;
}

// ---------------------------------------------------------------------------
// AI SDK Engine
// ---------------------------------------------------------------------------

/**
 * Maps Agent OS tool handlers to AI SDK CoreTool format,
 * bridges fullStream events to canonical AgentEvents,
 * and delegates tool execution to the ToolKernel.
 */
export class AiSdkEngine implements AgentEngine {
  private model: AiSdkEngineConfig['model'];
  private toolKernel: ToolKernel;
  private maxSteps: number;

  constructor(config: AiSdkEngineConfig) {
    this.model = config.model;
    this.toolKernel = config.toolKernel;
    this.maxSteps = config.maxSteps ?? 25;
  }

  /**
   * Execute a run. Produces canonical AgentEvents.
   *
   * Strategy:
   * 1. Convert Agent OS tools to AI SDK CoreTools
   * 2. Call streamText with ToolLoopAgent (maxSteps)
   * 3. Iterate fullStream, mapping each part to AgentEvents
   * 4. Yield events one at a time
   */
  async *run(req: EngineRunRequest): AsyncIterable<AgentEvent> {
    const runId = req.runConfig.sessionId; // Will be set by caller
    const sessionId = req.runConfig.sessionId;

    // Convert tools to AI SDK format
    const tools = this.buildTools(req.tools, runId, sessionId);

    // Build messages
    const messages = this.buildMessages(req);

    let seq = 0;
    let stepNumber = 0;

    const makeEvent = <T>(type: AgentEvent['type'], payload: T): AgentEvent<T> => ({
      eventId: generateId(),
      runId,
      sessionId,
      seq: ++seq,
      ts: now(),
      type,
      payload,
    });

    // Emit engine.request
    yield makeEvent<EngineRequestPayload>('engine.request', {
      model: req.runConfig.model ?? 'unknown',
      inputTokens: 0, // Updated in step-finish
      stepNumber: 0,
    });

    // Stream via AI SDK
    const result = streamText({
      model: this.model,
      system: req.systemPrompt,
      messages: messages as any,
      tools,
      maxSteps: this.maxSteps,
    });

    // Process fullStream
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          yield makeEvent<OutputDeltaPayload>('output.delta', {
            text: part.textDelta,
          });
          break;

        case 'tool-call':
          yield makeEvent<ToolCallPayload>('tool.call', {
            callId: part.toolCallId,
            toolId: part.toolName,
            args: part.args as Record<string, unknown>,
          });
          break;

        case 'tool-result':
          yield makeEvent<ToolResultPayload>('tool.result', {
            callId: part.toolCallId,
            toolId: part.toolName,
            result: part.result,
            durationMs: 0, // Not available from SDK
            approved: true,
          });
          break;

        case 'step-finish':
          stepNumber++;
          yield makeEvent<EngineResponsePayload>('engine.response', {
            outputTokens: part.usage?.totalTokens ?? 0,
            latencyMs: 0,
            finishReason: part.finishReason ?? 'unknown',
            stepNumber,
          });
          break;

        case 'error':
          // Errors are handled by the caller
          break;

        default:
          // Ignore other part types (reasoning, sources, etc.)
          break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Convert Agent OS tool handlers to AI SDK CoreTool format.
   * Each tool's execute function delegates to the ToolKernel.
   */
  private buildTools(
    tools: ToolHandler[],
    runId: string,
    sessionId: string,
  ): Record<string, CoreTool> {
    const aiTools: Record<string, CoreTool> = {};

    for (const tool of tools) {
      aiTools[tool.id] = {
        description: tool.description,
        parameters: tool.inputSchema as any,
        execute: async (args: any) => {
          return this.toolKernel.execute(tool.id, args, runId, sessionId);
        },
      };
    }

    return aiTools;
  }

  /**
   * Convert EngineMessages to AI SDK message format.
   */
  private buildMessages(req: EngineRunRequest): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    // Add conversation history
    for (const msg of req.messages) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // Add the current prompt as a user message
    messages.push({
      role: 'user',
      content: req.runConfig.prompt,
    });

    return messages;
  }
}
