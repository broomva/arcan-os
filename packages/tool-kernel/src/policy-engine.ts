/**
 * @arcan-os/tool-kernel — Policy Engine
 *
 * Loads and applies policy.yaml configuration.
 * (V1 spec §41)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ControlPath,
  PolicyConfig,
  RiskProfile,
  ToolPolicy,
} from '@arcan-os/core';
import { parse as parseYaml } from 'yaml';

// ---------------------------------------------------------------------------
// Default policy (when no policy.yaml exists)
// ---------------------------------------------------------------------------

const DEFAULT_POLICY: PolicyConfig = {
  workspace: {
    root: './',
    denyPatterns: ['**/.git/**'],
  },
  execution: {
    timeouts: {
      'process.run': 300,
    },
  },
  capabilities: {
    'repo.read': { approval: 'never' },
    'repo.search': { approval: 'never' },
    'repo.patch': { approval: 'always' },
    'repo.edit': { approval: 'always' },
    'process.run': { approval: 'risk' },
    'test.run': { approval: 'risk' },
    'lint.run': { approval: 'never' },
  },
  risk: {
    highRiskCommands: ['rm', 'sudo', 'curl', 'wget', 'chmod', 'chown'],
  },
  redaction: {
    keys: ['SECRET', 'TOKEN', 'API_KEY', 'PASSWORD', 'PRIVATE_KEY'],
  },
  limits: {
    maxStdout: 20000,
    maxDiffSize: 200000,
  },
};

// ---------------------------------------------------------------------------
// Policy Engine
// ---------------------------------------------------------------------------

export class PolicyEngine {
  private config: PolicyConfig;

  constructor(workspaceRoot?: string) {
    this.config = this.loadPolicy(workspaceRoot);
  }

  private loadPolicy(workspaceRoot?: string): PolicyConfig {
    if (!workspaceRoot) return { ...DEFAULT_POLICY };

    const policyPath = join(workspaceRoot, 'policy.yaml');
    if (!existsSync(policyPath)) return { ...DEFAULT_POLICY };

    try {
      const raw = readFileSync(policyPath, 'utf-8');
      const parsed = parseYaml(raw) as Partial<PolicyConfig>;
      // Deep merge with defaults
      return {
        workspace: { ...DEFAULT_POLICY.workspace, ...parsed.workspace },
        execution: { ...DEFAULT_POLICY.execution, ...parsed.execution },
        capabilities: {
          ...DEFAULT_POLICY.capabilities,
          ...parsed.capabilities,
        },
        risk: { ...DEFAULT_POLICY.risk, ...parsed.risk },
        redaction: { ...DEFAULT_POLICY.redaction, ...parsed.redaction },
        limits: { ...DEFAULT_POLICY.limits, ...parsed.limits },
      };
    } catch {
      return { ...DEFAULT_POLICY };
    }
  }

  /**
   * Get the policy for a specific tool.
   */
  getToolPolicy(toolId: string): ToolPolicy {
    return this.config.capabilities[toolId] ?? { approval: 'risk' };
  }

  /**
   * Determine the control path for a tool invocation based on risk.
   */
  getControlPath(toolId: string, risk: RiskProfile): ControlPath {
    const policy = this.getToolPolicy(toolId);

    switch (policy.approval) {
      case 'never':
        return 'auto';
      case 'always':
        return 'approval';
      case 'risk':
        // Check if any risk factor is elevated
        if (
          risk.estimatedImpact === 'large' ||
          risk.touchesSecrets ||
          risk.touchesConfig
        ) {
          return 'approval';
        }
        if (risk.estimatedImpact === 'medium') {
          return 'preview';
        }
        return 'auto';
      default:
        return 'approval'; // safe default
    }
  }

  /**
   * Get timeout in seconds for a tool.
   */
  getTimeout(toolId: string): number {
    return this.config.execution.timeouts[toolId] ?? 60;
  }

  /**
   * Get workspace deny patterns.
   */
  getDenyPatterns(): string[] {
    return this.config.workspace.denyPatterns;
  }

  /**
   * Get high-risk command list.
   */
  getHighRiskCommands(): string[] {
    return this.config.risk.highRiskCommands;
  }

  /**
   * Get redaction keys.
   */
  getRedactionKeys(): string[] {
    return this.config.redaction.keys;
  }

  /**
   * Get output limits.
   */
  getLimits(): { maxStdout: number; maxDiffSize: number } {
    return this.config.limits;
  }

  /**
   * Get the full resolved config (for debugging).
   */
  getConfig(): PolicyConfig {
    return this.config;
  }
}
