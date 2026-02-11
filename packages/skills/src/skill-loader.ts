/**
 * @agent-os/skills — Skill Loader
 *
 * Discovers and loads SKILL.md files from multiple paths.
 * Compatible with skills.sh (https://skills.sh/) format.
 *
 * Discovery paths (searched in order):
 *   1. Workspace-local: {workspace}/.agent/skills/SKILL.md
 *   2. skills.sh installed: {workspace}/.skills/SKILL.md
 *   3. Global: ~/.agent-os/skills/SKILL.md
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Skill {
  /** Unique skill name (from frontmatter or directory name) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Skill version (from frontmatter) */
  version?: string;
  /** License (from frontmatter) */
  license?: string;
  /** Full markdown content (including frontmatter) */
  rawContent: string;
  /** Markdown content without frontmatter */
  content: string;
  /** Path to the SKILL.md file */
  path: string;
  /** Source type */
  source: 'workspace' | 'installed' | 'global';
  /** Reference files listed in the skill */
  references: string[];
}

export interface SkillLoadOptions {
  workspace: string;
  /** Additional custom skill paths to scan */
  additionalPaths?: string[];
  /** Home directory override (for testing) */
  homeDir?: string;
}

// ---------------------------------------------------------------------------
// Skill Loader
// ---------------------------------------------------------------------------

/**
 * Load all skills from standard discovery paths.
 */
export function loadSkills(opts: SkillLoadOptions): Skill[] {
  const skills: Skill[] = [];
  const homeDir = opts.homeDir ?? (process.env.HOME || '~');

  // Discovery paths in priority order
  const paths: Array<{ dir: string; source: Skill['source'] }> = [
    { dir: join(opts.workspace, '.agent', 'skills'), source: 'workspace' },
    { dir: join(opts.workspace, '.skills'), source: 'installed' },
    { dir: join(homeDir, '.agent-os', 'skills'), source: 'global' },
    ...(opts.additionalPaths ?? []).map((p) => ({
      dir: resolve(p),
      source: 'workspace' as const,
    })),
  ];

  for (const { dir, source } of paths) {
    if (!existsSync(dir)) continue;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = join(dir, entry.name, 'SKILL.md');
      if (!existsSync(skillMdPath)) continue;

      // Don't load duplicates (first found wins)
      if (skills.some((s) => s.name === entry.name)) continue;

      const skill = parseSkillFile(skillMdPath, entry.name, source);
      if (skill) {
        skills.push(skill);
      }
    }
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a SKILL.md file into a Skill object.
 * Handles YAML frontmatter (--- delimited) + markdown body.
 */
export function parseSkillFile(
  filePath: string,
  fallbackName: string,
  source: Skill['source'],
): Skill | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const { frontmatter, content } = parseFrontmatter(raw);

    // Extract references (lines like `- ./references/foo.md -- description`)
    const references: string[] = [];
    const refPattern = /^\s*-\s+(\.\/[^\s]+)/gm;
    let match = refPattern.exec(content);
    while (match !== null) {
      references.push(match[1]);
      match = refPattern.exec(content);
    }

    return {
      name: frontmatter.name ?? fallbackName,
      description: frontmatter.description ?? '',
      version: frontmatter.version,
      license: frontmatter.license,
      rawContent: raw,
      content,
      path: filePath,
      source,
      references,
    };
  } catch {
    return null;
  }
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns { frontmatter: Record<string, string>, content: string }
 */
export function parseFrontmatter(raw: string): {
  frontmatter: Record<string, string>;
  content: string;
} {
  const lines = raw.split('\n');

  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, content: raw };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontmatter: {}, content: raw };
  }

  // Simple YAML key: value parser (no dependency needed for this)
  const frontmatter: Record<string, string> = {};
  for (let i = 1; i < endIndex; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      frontmatter[key] = value;
    }
  }

  const content = lines
    .slice(endIndex + 1)
    .join('\n')
    .trim();

  return { frontmatter, content };
}
