/**
 * @agent-os/context — Context Assembler
 *
 * Assembles the system prompt and messages for an EngineRunRequest.
 * Merges: base prompt + skills + workspace info.
 */

import type { EngineRunRequest, EngineMessage, RunConfig } from '@agent-os/core';
import type { ToolHandler } from '@agent-os/core';
import type { SkillRegistry } from '@agent-os/skills';
import { injectSkills } from '@agent-os/skills';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextAssemblerConfig {
  /** Base system prompt */
  basePrompt: string;
  /** Skill registry */
  skillRegistry: SkillRegistry;
  /** Workspace root path */
  workspace: string;
}

// ---------------------------------------------------------------------------
// Context Assembler
// ---------------------------------------------------------------------------

export class ContextAssembler {
  private basePrompt: string;
  private skillRegistry: SkillRegistry;
  private workspace: string;

  constructor(config: ContextAssemblerConfig) {
    this.basePrompt = config.basePrompt;
    this.skillRegistry = config.skillRegistry;
    this.workspace = config.workspace;
  }

  /**
   * Assemble the full EngineRunRequest from a RunConfig + conversation history.
   */
  assemble(opts: {
    runConfig: RunConfig;
    messages: EngineMessage[];
    tools: ToolHandler[];
  }): EngineRunRequest {
    const systemPrompt = this.buildSystemPrompt(opts.runConfig);

    return {
      runConfig: opts.runConfig,
      systemPrompt,
      messages: opts.messages,
      tools: opts.tools,
    };
  }

  /**
   * Build the full system prompt from components.
   */
  buildSystemPrompt(config: RunConfig): string {
    const sections: string[] = [];

    // 1. Base prompt
    sections.push(this.basePrompt);

    // 2. Workspace context
    sections.push(this.buildWorkspaceSection(config));

    // 3. Active skills
    const activeSkills = this.skillRegistry.filter(config.skills);
    const skillSection = injectSkills(activeSkills);
    if (skillSection) {
      sections.push(skillSection);
    }

    return sections.filter(Boolean).join('\n\n');
  }

  /**
   * Build workspace context section.
   */
  private buildWorkspaceSection(config: RunConfig): string {
    const workspace = config.workspace ?? this.workspace;

    return `## Workspace

- Root: \`${workspace}\`
- Session: \`${config.sessionId}\``;
  }
}
