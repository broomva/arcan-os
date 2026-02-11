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

import { streamText, type CoreTool } from 'ai';
import type {
  AgentEngine,
  AgentEvent,
  EngineRunRequest,
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
  /** Max steps for the agent tool loop (default: 25) */
  maxSteps?: number;
  /** Enable OTel telemetry (default: true) */
  telemetryEnabled?: boolean;
  /** Custom OTel tracer for telemetry */
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
      inputTokens: 0,
      stepNumber: 0,
    });

    // Stream via AI SDK — this IS the ToolLoopAgent
    const result = streamText({
      model: this.model,
      system: req.systemPrompt,
      messages: messages as any,
      tools,
      maxSteps: this.maxSteps,

      // ---------------------------------------------------------------
      // needsApproval — pauses the tool loop for approval-required tools
      // When this returns true, the SDK emits a tool-call but does NOT
      // auto-execute it. The daemon handles the approval flow.
      // ---------------------------------------------------------------
      needsApproval: ({ toolName, args }) => {
        return this.toolKernel.needsApproval(toolName, args as Record<string, unknown>);
      },

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
    });

    // Process fullStream — map each AI SDK part to a canonical AgentEvent
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
            durationMs: 0,
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
