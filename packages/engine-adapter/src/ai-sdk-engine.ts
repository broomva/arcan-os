/**
 * @arcan-os/engine-adapter — AI SDK Engine
 *
 * Wraps the Vercel AI SDK streamText to produce canonical AgentEvents.
 * Implements the AgentEngine interface from @arcan-os/core.
 *
 * This IS the ToolLoopAgent — AI SDK's `maxSteps` drives the multi-step
 * tool loop. The engine:
 *   1. Converts Arcan OS tools → AI SDK CoreTools (delegating to ToolKernel)
 *   2. Wires `needsApproval` to pause the loop for approval-required tools
 *   3. Iterates `fullStream`, mapping each part to canonical AgentEvents
 *   4. Enables `experimental_telemetry` for OTel/LangSmith observability
 *
 * (V1 spec §12, unified_state_analysis §3)
 */

import type {
  AgentEngine,
  AgentEvent,
  ApprovalRequestedPayload,
  EngineRequestPayload,
  EngineResponsePayload,
  EngineRunRequest,
  OutputDeltaPayload,
  OutputMessagePayload,
  ToolCallPayload,
  ToolResultPayload,
} from '@arcan-os/core';
import { generateId, now } from '@arcan-os/core';
import type { ToolKernel } from '@arcan-os/tool-kernel';
import {
  type ModelMessage,
  stepCountIs,
  streamText,
  type TextStreamPart,
  type ToolSet,
  tool,
} from 'ai';

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
    const runId = req.runId;
    const sessionId = req.runConfig.sessionId;

    // Convert tools to AI SDK format
    const tools = this.buildTools(
      req.tools,
      runId,
      sessionId,
      req.runConfig.workspace,
    );

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
      messages,
      tools,
      stopWhen: stepCountIs(this.maxSteps),

      // ---------------------------------------------------------------
      // experimental_telemetry — OTel span emission for observability
      // Consumed by any OTel exporter (Jaeger, Honeycomb, LangSmith)
      // ---------------------------------------------------------------
      experimental_telemetry: this.telemetryEnabled
        ? {
            isEnabled: true,
            functionId: `arcan-os/run/${runId}`,
            metadata: {
              runId,
              sessionId,
              model: req.runConfig.model ?? 'unknown',
            },
            ...(this.tracer ? { tracer: this.tracer } : {}),
          }
        : undefined,
    });

    // Process fullStream — map each AI SDK v6 TextStreamPart to a canonical AgentEvent
    const stream: AsyncIterable<TextStreamPart<ToolSet>> = result.fullStream;
    for await (const p of stream) {
      switch (p.type) {
        // ----- Text output -----
        case 'text-delta':
          yield makeEvent<OutputDeltaPayload>('output.delta', {
            text: p.text,
          });
          currentMessageContent += p.text ?? '';
          break;

        // ----- Reasoning (thinking) -----
        case 'reasoning-delta':
          yield makeEvent<OutputDeltaPayload>('output.delta', {
            text: p.text,
          });
          break;

        // ----- Tool execution -----
        case 'tool-call':
          yield makeEvent<ToolCallPayload>('tool.call', {
            callId: p.toolCallId,
            toolId: this.toToolId(p.toolName),
            args: (p.input ?? {}) as Record<string, unknown>,
          });
          break;

        case 'tool-result':
          yield makeEvent<ToolResultPayload>('tool.result', {
            callId: p.toolCallId,
            toolId: this.toToolId(p.toolName),
            result: p.output,
            durationMs: 0,
            approved: true,
          });
          break;

        case 'tool-error':
          yield makeEvent<ToolResultPayload>('tool.result', {
            callId: p.toolCallId,
            toolId: this.toToolId(p.toolName),
            result: { error: p.error },
            durationMs: 0,
            approved: true,
          });
          break;

        // ----- Approval flow (AI SDK v6 native) -----
        case 'tool-approval-request': {
          const toolId = this.toToolId(p.toolCall.toolName);
          const args = (p.toolCall.input ?? {}) as Record<string, unknown>;
          const risk = this.toolKernel.assessRisk(toolId, args);

          yield makeEvent<ApprovalRequestedPayload>('approval.requested', {
            approvalId: p.approvalId,
            callId: p.toolCall.toolCallId,
            toolId,
            args,
            preview: {},
            risk,
          });
          break;
        }

        case 'tool-output-denied':
          yield makeEvent<ToolResultPayload>('tool.result', {
            callId: p.toolCallId,
            toolId: this.toToolId(p.toolName),
            result: { denied: true },
            durationMs: 0,
            approved: false,
          });
          break;

        // ----- Step lifecycle -----
        case 'finish-step': {
          // Emit the full message if we have content
          if (currentMessageContent.trim()) {
            yield makeEvent<OutputMessagePayload>('output.message', {
              role: 'assistant',
              content: currentMessageContent,
            });
            currentMessageContent = '';
          }

          stepNumber++;

          yield makeEvent<EngineResponsePayload>('engine.response', {
            outputTokens: p.usage?.totalTokens ?? 0,
            latencyMs: 0,
            finishReason: p.finishReason ?? 'unknown',
            stepNumber,
          });
          break;
        }

        // ----- Stream lifecycle markers (silently ignored) -----
        case 'start':
        case 'start-step':
        case 'finish':
        case 'text-start':
        case 'text-end':
        case 'reasoning-start':
        case 'reasoning-end':
        case 'tool-input-start':
        case 'tool-input-delta':
        case 'tool-input-end':
        case 'source':
        case 'file':
        case 'raw':
        case 'abort':
          break;

        case 'error':
          console.error('[AiSdkEngine] Stream error:', p.error);
          break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private toToolId(name: string): string {
    return name.replace(/_/g, '.');
  }

  /**
   * Convert Arcan OS tool handlers to AI SDK CoreTool format.
   * Each tool's execute function delegates to the ToolKernel.
   * Uses AI SDK v6 `tool()` helper for proper type inference
   * and wires `needsApproval` from the ToolKernel policy engine.
   */
  private buildTools(
    tools: import('@arcan-os/core').ToolHandler[],
    runId: string,
    sessionId: string,
    workspace?: string,
  ): ToolSet {
    const aiTools: ToolSet = {};
    const kernel = this.toolKernel;

    for (const t of tools) {
      // AI SDK / Anthropic does not allow dots in tool names
      const safeName = t.id.replace(/\./g, '_');
      const toolId = t.id;

      aiTools[safeName] = tool({
        description: t.description,
        inputSchema: t.inputSchema,
        needsApproval: (input: unknown) => {
          return kernel.needsApproval(
            toolId,
            (input ?? {}) as Record<string, unknown>,
          );
        },
        execute: async (input: unknown) => {
          return kernel.execute(
            toolId,
            (input ?? {}) as Record<string, unknown>,
            runId,
            sessionId,
            workspace,
          );
        },
      });
    }

    return aiTools;
  }

  /**
   * Convert EngineMessages to AI SDK v6 ModelMessage format.
   */
  private buildMessages(req: EngineRunRequest): ModelMessage[] {
    const messages: ModelMessage[] = [];

    for (const msg of req.messages) {
      switch (msg.role) {
        case 'system':
          messages.push({ role: 'system', content: msg.content });
          break;
        case 'user':
          messages.push({ role: 'user', content: msg.content });
          break;
        case 'assistant':
          messages.push({ role: 'assistant', content: msg.content });
          break;
        case 'tool':
          messages.push({
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: msg.toolCallId ?? '',
                toolName: msg.toolName ?? '',
                output: { type: 'text', value: msg.content },
              },
            ],
          });
          break;
      }
    }

    messages.push({
      role: 'user',
      content: req.runConfig.prompt,
    });

    return messages;
  }
}
