/**
 * @arcan-os/core — Engine types
 *
 * Engine abstraction interface. The OS depends on this single interface.
 * Nothing else in the system knows which AI provider is being used.
 * (V1 spec §12)
 */

import type { AgentEvent } from './events.js';
import type { RunConfig } from './run.js';
import type { ToolHandler } from './tools.js';

// ---------------------------------------------------------------------------
// Engine chunks (adapter output)
// ---------------------------------------------------------------------------

export type EngineChunkKind =
  | 'text-delta'
  | 'reasoning-delta'
  | 'tool-call'
  | 'tool-result'
  | 'tool-error'
  | 'tool-approval-request'
  | 'step-start'
  | 'finish-step'
  | 'start'
  | 'finish'
  | 'source'
  | 'error';

export interface EngineChunk {
  kind: EngineChunkKind;
  /** For text-delta / reasoning-delta */
  text?: string;
  /** For tool-call / tool-result / tool-error / tool-approval-request */
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  /** For tool-result */
  result?: unknown;
  /** For tool-error */
  toolError?: string;
  /** For tool-approval-request */
  approvalId?: string;
  /** For finish-step */
  stepNumber?: number;
  finishReason?: string;
  usage?: { inputTokens: number; outputTokens: number };
  /** For error */
  error?: string;
}

// ---------------------------------------------------------------------------
// Engine run request
// ---------------------------------------------------------------------------

export interface EngineRunRequest {
  runConfig: RunConfig;
  /** Assembled system prompt (from ContextAssembler) */
  systemPrompt: string;
  /** Conversation messages (from MessageHistory projection) */
  messages: EngineMessage[];
  /** Registered tools (from ToolKernel) */
  tools: ToolHandler[];
}

export interface EngineMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** For tool messages */
  toolCallId?: string;
  toolName?: string;
}

// ---------------------------------------------------------------------------
// Engine interface (the one interface the OS depends on)
// ---------------------------------------------------------------------------

/**
 * The engine adapter implements this interface.
 * It wraps the AI provider (AI SDK ToolLoopAgent) and produces
 * a stream of AgentEvents that the RunManager consumes.
 */
export interface AgentEngine {
  /**
   * Execute a run. Yields canonical AgentEvents.
   * The engine adapter is responsible for:
   * - Invoking the LLM via ToolLoopAgent
   * - Mapping fullStream events to AgentEvents
   * - Handling tool execution through the ToolKernel
   * - Pausing on needsApproval
   */
  run(req: EngineRunRequest): AsyncIterable<AgentEvent>;
}
