/**
 * @agent-os/tool-kernel — Tool Kernel
 *
 * Tool registration, risk assessment, workspace jail enforcement,
 * and tool execution with policy-driven control paths.
 * (V1 spec §5)
 */

import { relative, resolve } from 'node:path';
import type {
  ControlPath,
  RiskProfile,
  ToolContext,
  ToolHandler,
} from '@agent-os/core';
import { PolicyEngine } from './policy-engine.js';

// ---------------------------------------------------------------------------
// Tool Kernel
// ---------------------------------------------------------------------------

export class ToolKernel {
  private tools = new Map<string, ToolHandler>();
  readonly policy: PolicyEngine;

  constructor(
    private workspaceRoot: string,
    policy?: PolicyEngine,
  ) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.policy = policy ?? new PolicyEngine(this.workspaceRoot);
  }

  // -------------------------------------------------------------------------
  // Tool registration
  // -------------------------------------------------------------------------

  /**
   * Register a tool handler.
   */
  register(tool: ToolHandler): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool already registered: ${tool.id}`);
    }
    this.tools.set(tool.id, tool);
  }

  /**
   * Get a registered tool.
   */
  getTool(toolId: string): ToolHandler | undefined {
    return this.tools.get(toolId);
  }

  /**
   * Get all registered tools.
   */
  getTools(): ToolHandler[] {
    return Array.from(this.tools.values());
  }

  // -------------------------------------------------------------------------
  // Risk assessment (V1 spec §38)
  // -------------------------------------------------------------------------

  /**
   * Assess the risk of a tool invocation.
   */
  assessRisk(toolId: string, args: Record<string, unknown>): RiskProfile {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return {
        toolId,
        category: 'exec',
        estimatedImpact: 'large',
        touchesSecrets: false,
        touchesConfig: false,
        touchesBuild: false,
      };
    }

    const path = (args.path as string) ?? '';
    const command = (args.command as string) ?? '';

    return {
      toolId,
      category: tool.category,
      estimatedImpact: this.estimateImpact(tool, args),
      touchesSecrets: this.checkSecrets(path, command),
      touchesConfig: this.checkConfig(path),
      touchesBuild: this.checkBuild(path),
    };
  }

  /**
   * Get the control path for a tool invocation.
   */
  getControlPath(toolId: string, args: Record<string, unknown>): ControlPath {
    const risk = this.assessRisk(toolId, args);
    return this.policy.getControlPath(toolId, risk);
  }

  /**
   * Check whether a tool call needs approval (for AI SDK needsApproval hook).
   */
  needsApproval(toolId: string, args: Record<string, unknown>): boolean {
    const path = this.getControlPath(toolId, args);
    return path === 'approval' || path === 'preview';
  }

  // -------------------------------------------------------------------------
  // Workspace jail (V1 spec §5.1)
  // -------------------------------------------------------------------------

  /**
   * Validate that a path is within the workspace boundary.
   * Throws if the path escapes the jail.
   */
  validatePath(targetPath: string): string {
    const resolved = resolve(this.workspaceRoot, targetPath);
    const rel = relative(this.workspaceRoot, resolved);

    if (rel.startsWith('..') || resolve(rel) === resolved) {
      throw new Error(`Path escapes workspace jail: ${targetPath}`);
    }

    // Check deny patterns
    const denyPatterns = this.policy.getDenyPatterns();
    for (const pattern of denyPatterns) {
      if (this.matchesPattern(rel, pattern)) {
        throw new Error(
          `Path matches deny pattern "${pattern}": ${targetPath}`,
        );
      }
    }

    return resolved;
  }

  // -------------------------------------------------------------------------
  // Tool execution
  // -------------------------------------------------------------------------

  /**
   * Execute a tool within the sandboxed context.
   * Enforces workspace jail, timeouts, and output limits.
   */
  async execute(
    toolId: string,
    args: Record<string, unknown>,
    runId: string,
    sessionId: string,
    workspaceOverride?: string,
  ): Promise<unknown> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolId}`);
    }

    // Validate input against schema
    const parsedInput = tool.inputSchema.parse(args);

    // Create execution context with timeout
    const timeoutMs = this.policy.getTimeout(toolId) * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const ctx: ToolContext = {
      workspaceRoot: workspaceOverride ?? this.workspaceRoot,
      runId,
      sessionId,
      signal: controller.signal,
    };

    try {
      const result = await tool.execute(parsedInput, ctx);
      return this.enforceOutputLimits(result);
    } finally {
      clearTimeout(timer);
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private estimateImpact(
    tool: ToolHandler,
    args: Record<string, unknown>,
  ): RiskProfile['estimatedImpact'] {
    if (tool.category === 'read') return 'small';

    if (tool.category === 'exec') {
      const command = (args.command as string) ?? '';
      const highRisk = this.policy.getHighRiskCommands();
      const cmd = command.split(/\s+/)[0] ?? '';
      if (highRisk.includes(cmd)) return 'large';
      return 'medium';
    }

    // write category
    return 'medium';
  }

  private checkSecrets(path: string, command: string): boolean {
    const redactionKeys = this.policy.getRedactionKeys();
    const combined = `${path} ${command}`.toUpperCase();
    return redactionKeys.some((key) => combined.includes(key));
  }

  private checkConfig(path: string): boolean {
    const configPatterns = [
      '.env',
      'config.',
      'tsconfig.',
      'package.json',
      'policy.yaml',
    ];
    return configPatterns.some((p) => path.includes(p));
  }

  private checkBuild(path: string): boolean {
    const buildPatterns = [
      'webpack',
      'vite',
      'turbo',
      'next.config',
      'Makefile',
    ];
    return buildPatterns.some((p) => path.includes(p));
  }

  private matchesPattern(path: string, pattern: string): boolean {
    // Simple glob matching (covers **/* patterns)
    const toRegex = (p: string) => {
      const r = p
        .replace(/\*\*/g, '{{GLOBSTAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/{{GLOBSTAR}}/g, '.*');
      return new RegExp(`^${r}$`);
    };

    if (toRegex(pattern).test(path)) return true;

    // Also try stripping a leading **/ so "**/.git/**" matches ".git/config"
    if (pattern.startsWith('**/')) {
      const stripped = pattern.slice(3);
      if (toRegex(stripped).test(path)) return true;
    }

    return false;
  }

  private enforceOutputLimits(result: unknown): unknown {
    if (typeof result === 'string') {
      const maxStdout = this.policy.getLimits().maxStdout;
      if (result.length > maxStdout) {
        return `${result.slice(0, maxStdout)}\n... [truncated at ${maxStdout} chars]`;
      }
    }
    return result;
  }
}
