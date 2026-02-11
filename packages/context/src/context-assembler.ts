/**
 * @agent-os/context — Context Assembler
 *
 * Assembles the system prompt and messages for an EngineRunRequest.
 * Merges: base prompt + skills + workspace info.
 */

import type {
  EngineMessage,
  EngineRunRequest,
  RunConfig,
  SessionSnapshotData,
} from '@agent-os/core';
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
    sessionSnapshot?: SessionSnapshotData;
  }): EngineRunRequest {
    const systemPrompt = this.buildSystemPrompt(
      opts.runConfig,
      opts.sessionSnapshot,
    );

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
  buildSystemPrompt(config: RunConfig, snapshot?: SessionSnapshotData): string {
    const sections: string[] = [];

    // 1. Base prompt
    sections.push(this.basePrompt);

    // 2. Workspace context
    sections.push(this.buildWorkspaceSection(config));

    // 3. Observational Memory
    const memorySection = this.buildMemorySection(snapshot);
    if (memorySection) {
      sections.push(memorySection);
    }

    // 4. Active skills
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

  /**
   * Build Observational Memory section.
   * In a real implementation, this would query the EventStore or a vector DB.
   * For now, we assume the snapshot data is passed in effectively or we query it if we had the store.
   *
   * @todo In v2, ContextAssembler should have access to EventStore to look up the session snapshot.
   * For now, we'll assume the `RunConfig` or an auxiliary mechanism provides it,
   * OR we just pass the snapshot in `assemble`.
   *
   * Let's change `assemble` to accept an optional `snapshot` of type `SessionSnapshotData`.
   */
  private buildMemorySection(snapshot?: SessionSnapshotData): string {
    if (!snapshot) return '';

    const sections: string[] = [];

    // Reflections (High-level insights)
    if (snapshot.reflections && snapshot.reflections.length > 0) {
      const topReflections = snapshot.reflections
        .sort((a, b) => b.frequency - a.frequency) // Sort by frequency
        .slice(0, 5) // Top 5
        .map((r) => `- ${r.topic}: ${r.content}`)
        .join('\n');

      sections.push(`## Long-Term Memory (Reflections)\n${topReflections}`);
    }

    // Recent Observations (Short-term facts)
    if (snapshot.observations && snapshot.observations.length > 0) {
      const recentObs = snapshot.observations
        .sort((a, b) => b.ts - a.ts) // Newest first
        .slice(0, 10) // Last 10
        .map((o) => `- [${o.type}] ${o.content}`)
        .join('\n');

      sections.push(`## Recent Observations\n${recentObs}`);
    }

    return sections.join('\n\n');
  }
}
