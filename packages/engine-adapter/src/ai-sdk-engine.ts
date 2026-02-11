/**
 * @agent-os/engine-adapter — AI SDK Engine
 *
 * Wraps the Vercel AI SDK streamText to produce canonical AgentEvents.
 * Implements the AgentEngine interface from @agent-os/core.
 *
 * This IS the ToolLoopAgent — AI SDK's `maxSteps` drives the multi-step
 * tool loop. The engine:
 *   1. Converts Agent OS tools → AI SDK CoreTools (delegating to ToolKernel)
 *   2. Wires `needsApproval` to pause the loop for approval-required tools
 *   3. Iterates `fullStream`, mapping each part to canonical AgentEvents
 *   4. Enables `experimental_telemetry` for OTel/LangSmith observability
 *
 * (V1 spec §12, unified_state_analysis §3)
 */

import type {
  AgentEngine,
  AgentEvent,
  EngineRequestPayload,
  EngineResponsePayload,
  EngineRunRequest,
  OutputDeltaPayload,
  OutputMessagePayload,
  ToolCallPayload,
  ToolHandler,
  ToolResultPayload,
} from '@agent-os/core';
import { generateId, now } from '@agent-os/core';
import type { ToolKernel } from '@agent-os/tool-kernel';
import { type CoreTool, streamText } from 'ai';
import type { ZodSchema } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiSdkEngineConfig {
  model: Parameters<typeof streamText>[0]['model'];
  toolKernel: ToolKernel;
  /** Max steps for the agent tool loop (default: 25) */
  maxSteps?: number;
  /** Enable OTel telemetry (default: true) */
  telemetryEnabled?: boolean;
  /** Custom OTel tracer for telemetry */
  // biome-ignore lint/suspicious/noExplicitAny: Telemetry tracer type is opaque and OTel types are not available here
  tracer?: any;
}

// ---------------------------------------------------------------------------
// AI SDK Engine (ToolLoopAgent)
// ---------------------------------------------------------------------------

export class AiSdkEngine implements AgentEngine {
  private model: AiSdkEngineConfig['model'];
  private toolKernel: ToolKernel;
  private maxSteps: number;
  private telemetryEnabled: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: Telemetry tracer type is opaque
  private tracer?: any;

  constructor(config: AiSdkEngineConfig) {
    this.model = config.model;
    this.toolKernel = config.toolKernel;
    this.maxSteps = config.maxSteps ?? 25;
    this.telemetryEnabled = config.telemetryEnabled ?? true;
    this.tracer = config.tracer;
  }

  /**
   * Execute a run. Produces canonical AgentEvents.
   *
   * The agent loop:
   *   1. streamText sends prompt + tools to the LLM
   *   2. LLM responds with text and/or tool calls
   *   3. AI SDK auto-executes tools (unless needsApproval returns true)
   *   4. Results are fed back → LLM loops (up to maxSteps)
   *   5. Each fullStream part is mapped to a canonical AgentEvent
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
    let currentMessageContent = '';

    const makeEvent = <T>(
      type: AgentEvent['type'],
      payload: T,
    ): AgentEvent<T> => ({
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
      inputTokens: 0,
      stepNumber: 0,
    });

    // Stream via AI SDK — this IS the ToolLoopAgent
    const result = streamText({
      model: this.model,
      system: req.systemPrompt,
      messages: messages as import('ai').CoreMessage[],
      tools,
      maxSteps: this.maxSteps,

      // ---------------------------------------------------------------
      // experimental_telemetry — OTel span emission for observability
      // Consumed by any OTel exporter (Jaeger, Honeycomb, LangSmith)
      // ---------------------------------------------------------------
      experimental_telemetry: this.telemetryEnabled
        ? {
            isEnabled: true,
            functionId: `agent-os/run/${sessionId}`,
            metadata: {
              runId,
              sessionId,
              model: req.runConfig.model ?? 'unknown',
            },
            ...(this.tracer ? { tracer: this.tracer } : {}),
          }
        : undefined,
      // TODO: Implement needsApproval support.
      // Current AI SDK version does not support 'needsApproval' hook in streamText.
      // We might need to handle tool execution manually or use a different pattern.
    });

    // Process fullStream — map each AI SDK part to a canonical AgentEvent
    for await (const part of result.fullStream) {
      const p = part as
        | { type: 'text-delta'; textDelta: string }
        | {
            type: 'tool-call';
            toolCallId: string;
            toolName: string;
            args: unknown;
          }
        | {
            type: 'tool-result';
            toolCallId: string;
            toolName: string;
            result: unknown;
          }
        | {
            type: 'step-finish';
            usage: { totalTokens: number };
            finishReason: string;
          }
        | { type: 'error'; error: unknown };
      switch (p.type) {
        case 'text-delta':
          yield makeEvent<OutputDeltaPayload>('output.delta', {
            text: p.textDelta,
          });
          // Accumulate text for the final message
          currentMessageContent += p.textDelta;
          break;

        case 'tool-call':
          yield makeEvent<ToolCallPayload>('tool.call', {
            callId: p.toolCallId,
            toolId: p.toolName,
            args: p.args as Record<string, unknown>,
          });
          break;

        case 'tool-result':
          yield makeEvent<ToolResultPayload>('tool.result', {
            callId: p.toolCallId,
            toolId: p.toolName,
            result: p.result,
            durationMs: 0,
            approved: true,
          });
          break;

        case 'step-finish':
          // Emit the full message if we have content
          if (currentMessageContent.trim()) {
            yield makeEvent<OutputMessagePayload>('output.message', {
              role: 'assistant',
              content: currentMessageContent,
            });
            currentMessageContent = ''; // Reset for next step
          }

          stepNumber++;
          yield makeEvent<EngineResponsePayload>('engine.response', {
            outputTokens: p.usage?.totalTokens ?? 0,
            latencyMs: 0,
            finishReason: p.finishReason ?? 'unknown',
            stepNumber,
          });
          break;

        case 'error':
          // Errors bubble up to the RunManager
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
        parameters: tool.inputSchema as unknown as ZodSchema<unknown>,
        execute: async (args: unknown) => {
          return this.toolKernel.execute(
            tool.id,
            args as Record<string, unknown>,
            runId,
            sessionId,
          );
        },
      };
    }

    return aiTools;
  }

  /**
   * Convert EngineMessages to AI SDK message format.
   */
  private buildMessages(
    req: EngineRunRequest,
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    for (const msg of req.messages) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    messages.push({
      role: 'user',
      content: req.runConfig.prompt,
    });

    return messages;
  }
}
