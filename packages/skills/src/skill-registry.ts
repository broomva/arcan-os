/**
 * @arcan-os/skills — Skill Registry
 *
 * Indexes loaded skills and filters by relevance.
 * Supports filtering by name (from RunConfig.skills) and fuzzy matching.
 */

import type { Skill, SkillLoadOptions } from './skill-loader.js';
import { loadSkills } from './skill-loader.js';

// ---------------------------------------------------------------------------
// Skill Registry
// ---------------------------------------------------------------------------

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  constructor(opts?: SkillLoadOptions) {
    if (opts) {
      this.loadFromPaths(opts);
    }
  }

  /**
   * Load skills from filesystem paths.
   */
  loadFromPaths(opts: SkillLoadOptions): void {
    const loaded = loadSkills(opts);
    for (const skill of loaded) {
      this.skills.set(skill.name, skill);
    }
  }

  /**
   * Register a skill manually (e.g., from inline definition).
   */
  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  /**
   * Get all registered skills.
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get a skill by name.
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Get the number of registered skills.
   */
  get size(): number {
    return this.skills.size;
  }

  /**
   * Filter skills by name list.
   * If names is empty or undefined, returns all skills.
   */
  filter(names?: string[]): Skill[] {
    if (!names || names.length === 0) {
      return this.getAll();
    }

    return names
      .map((name) => this.skills.get(name))
      .filter((s): s is Skill => s !== undefined);
  }

  /**
   * Search skills by query (matches name or description).
   */
  search(query: string): Skill[] {
    const lower = query.toLowerCase();
    return this.getAll().filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower),
    );
  }

  /**
   * List skill names grouped by source.
   */
  listBySource(): Record<Skill['source'], string[]> {
    const result: Record<Skill['source'], string[]> = {
      workspace: [],
      installed: [],
      global: [],
    };

    for (const skill of this.skills.values()) {
      result[skill.source].push(skill.name);
    }

    return result;
  }
}
