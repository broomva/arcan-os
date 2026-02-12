/**
 * @arcan-os/core — Tool types
 *
 * Tool handler interface and context for the tool kernel.
 * (V1 spec §5)
 */

import type { ZodType } from 'zod';
import type { RiskProfile } from './events.js';

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

/**
 * Every tool registered with the kernel implements this interface.
 * The engine never executes tools directly — only through the kernel.
 */
export interface ToolHandler<I = unknown, O = unknown> {
  /** Unique tool identifier (e.g., 'repo.read', 'repo.patch') */
  id: string;
  /** Human-readable description for LLM tool selection */
  description: string;
  /** Zod schema for input validation */
  inputSchema: ZodType<I>;
  /** Tool category for risk classification */
  category: 'read' | 'write' | 'exec' | 'network';
  /** Execute the tool within a sandboxed context */
  execute(input: I, ctx: ToolContext): Promise<O>;
}

// ---------------------------------------------------------------------------
// Tool context
// ---------------------------------------------------------------------------

/** Context provided to every tool execution */
export interface ToolContext {
  /** Absolute path to the workspace root (jail boundary) */
  workspaceRoot: string;
  /** Run this tool execution belongs to */
  runId: string;
  /** Session this tool execution belongs to */
  sessionId: string;
  /** Abort signal for timeout enforcement */
  signal: AbortSignal;
}

// ---------------------------------------------------------------------------
// Tool control paths (V1 spec §38)
// ---------------------------------------------------------------------------

export type ControlPath = 'auto' | 'preview' | 'approval' | 'deny';

// ---------------------------------------------------------------------------
// Tool policy (loaded from policy.yaml)
// ---------------------------------------------------------------------------

export interface ToolPolicy {
  approval: 'never' | 'always' | 'risk';
  riskThreshold?: RiskProfile['estimatedImpact'];
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Policy config (full policy.yaml schema)
// ---------------------------------------------------------------------------

export interface PolicyConfig {
  workspace: {
    root: string;
    denyPatterns: string[];
  };
  execution: {
    timeouts: Record<string, number>;
  };
  capabilities: Record<string, ToolPolicy>;
  risk: {
    highRiskCommands: string[];
  };
  redaction: {
    keys: string[];
  };
  limits: {
    maxStdout: number;
    maxDiffSize: number;
  };
}
