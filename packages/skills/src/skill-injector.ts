/**
 * @agent-os/skills — Skill Injector
 *
 * Formats skills into system prompt sections.
 * Each skill's content is wrapped in a clear section header.
 */

import type { Skill } from './skill-loader.js';

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------

/**
 * Format a list of skills into a system prompt section.
 *
 * Output format:
 * ```
 * ## Active Skills
 *
 * <skill name="building-ui">
 * # Expo UI Guidelines
 * ...content...
 * </skill>
 *
 * <skill name="data-fetching">
 * ...
 * </skill>
 * ```
 */
export function injectSkills(skills: Skill[]): string {
  if (skills.length === 0) return '';

  const sections = skills.map((skill) => {
    const header = `<skill name="${skill.name}">`;
    const footer = `</skill>`;

    return `${header}\n${skill.content}\n${footer}`;
  });

  return `## Active Skills\n\n${sections.join('\n\n')}`;
}

/**
 * Format a single skill for injection.
 */
export function formatSkill(skill: Skill): string {
  return `<skill name="${skill.name}">\n${skill.content}\n</skill>`;
}

/**
 * Get a compact summary of available skills (for debug/logging).
 */
export function summarizeSkills(skills: Skill[]): string {
  if (skills.length === 0) return 'No skills loaded.';

  const lines = skills.map(
    (s) => `  - ${s.name} (${s.source}): ${s.description || 'No description'}`,
  );

  return `Loaded ${skills.length} skill(s):\n${lines.join('\n')}`;
}
