/**
 * @arcan-os/skills — Tests
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { injectSkills, summarizeSkills } from '../src/skill-injector.js';
import { loadSkills, parseFrontmatter } from '../src/skill-loader.js';
import { SkillRegistry } from '../src/skill-registry.js';

const TEST_DIR = join(import.meta.dir, '__test_workspace__');

function createSkill(dir: string, name: string, content: string) {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), content);
}

function setup() {
  // Workspace skills
  const wsSkills = join(TEST_DIR, '.agent', 'skills');
  createSkill(
    wsSkills,
    'building-ui',
    `---
name: building-ui
description: Guide for building UI components
version: 1.0.0
---
# Building UI

Use components for everything.

- ./references/buttons.md -- Button patterns
- ./references/forms.md -- Form patterns
`,
  );

  createSkill(
    wsSkills,
    'data-fetching',
    `---
name: data-fetching
description: Data fetching patterns
---
# Data Fetching

Use SWR or React Query.
`,
  );

  // Installed skills (.skills/)
  const installed = join(TEST_DIR, '.skills');
  createSkill(
    installed,
    'deployment',
    `---
name: deployment
description: Deploy apps to production
---
# Deployment Guide

Deploy with Vercel.
`,
  );

  // Global skills
  const globalDir = join(TEST_DIR, '__global__', '.agent-os', 'skills');
  createSkill(
    globalDir,
    'testing',
    `---
name: testing
description: Testing best practices
---
# Testing

Write tests for everything.
`,
  );
}

function teardown() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// =========================================================================
// parseFrontmatter
// =========================================================================

describe('parseFrontmatter', () => {
  it('parses YAML frontmatter', () => {
    const { frontmatter, content } = parseFrontmatter(`---
name: test
description: A test skill
---
# Content here`);
    expect(frontmatter.name).toBe('test');
    expect(frontmatter.description).toBe('A test skill');
    expect(content).toBe('# Content here');
  });

  it('handles missing frontmatter', () => {
    const { frontmatter, content } = parseFrontmatter('# Just content');
    expect(frontmatter).toEqual({});
    expect(content).toBe('# Just content');
  });

  it('handles empty content after frontmatter', () => {
    const { frontmatter, content } = parseFrontmatter(`---
name: empty
---`);
    expect(frontmatter.name).toBe('empty');
    expect(content).toBe('');
  });
});

// =========================================================================
// loadSkills
// =========================================================================

describe('loadSkills', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('discovers workspace skills', () => {
    const skills = loadSkills({
      workspace: TEST_DIR,
      homeDir: join(TEST_DIR, '__global__'),
    });

    const names = skills.map((s) => s.name);
    expect(names).toContain('building-ui');
    expect(names).toContain('data-fetching');
  });

  it('discovers installed skills', () => {
    const skills = loadSkills({
      workspace: TEST_DIR,
      homeDir: join(TEST_DIR, '__global__'),
    });

    const names = skills.map((s) => s.name);
    expect(names).toContain('deployment');
  });

  it('discovers global skills', () => {
    const skills = loadSkills({
      workspace: TEST_DIR,
      homeDir: join(TEST_DIR, '__global__'),
    });

    const names = skills.map((s) => s.name);
    expect(names).toContain('testing');
  });

  it('sets correct source types', () => {
    const skills = loadSkills({
      workspace: TEST_DIR,
      homeDir: join(TEST_DIR, '__global__'),
    });

    const bySource = new Map(skills.map((s) => [s.name, s.source]));
    expect(bySource.get('building-ui')).toBe('workspace');
    expect(bySource.get('deployment')).toBe('installed');
    expect(bySource.get('testing')).toBe('global');
  });

  it('extracts references from content', () => {
    const skills = loadSkills({
      workspace: TEST_DIR,
      homeDir: join(TEST_DIR, '__global__'),
    });

    const ui = skills.find((s) => s.name === 'building-ui');
    if (!ui) throw new Error('building-ui skill not found');

    expect(ui.references).toContain('./references/buttons.md');
    expect(ui.references).toContain('./references/forms.md');
  });

  it('returns empty array for nonexistent workspace', () => {
    const skills = loadSkills({
      workspace: '/tmp/nonexistent-agent-os-test',
      homeDir: '/tmp/nonexistent-global',
    });
    expect(skills).toEqual([]);
  });
});

// =========================================================================
// SkillRegistry
// =========================================================================

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    setup();
    registry = new SkillRegistry({
      workspace: TEST_DIR,
      homeDir: join(TEST_DIR, '__global__'),
    });
  });

  afterEach(teardown);

  it('loads skills on construction', () => {
    expect(registry.size).toBe(4);
  });

  it('gets a skill by name', () => {
    const skill = registry.get('building-ui');
    expect(skill).toBeDefined();
    expect(skill?.description).toBe('Guide for building UI components');
  });

  it('filters by name list', () => {
    const filtered = registry.filter(['building-ui', 'deployment']);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((s) => s.name)).toEqual(['building-ui', 'deployment']);
  });

  it('filters returns all when names is empty', () => {
    expect(registry.filter([]).length).toBe(4);
    expect(registry.filter(undefined).length).toBe(4);
  });

  it('searches by description', () => {
    const results = registry.search('production');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('deployment');
  });

  it('lists by source', () => {
    const grouped = registry.listBySource();
    expect(grouped.workspace).toContain('building-ui');
    expect(grouped.installed).toContain('deployment');
    expect(grouped.global).toContain('testing');
  });
});

// =========================================================================
// Skill Injector
// =========================================================================

describe('injectSkills', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('injects skills into prompt format', () => {
    const registry = new SkillRegistry({
      workspace: TEST_DIR,
      homeDir: join(TEST_DIR, '__global__'),
    });

    const skills = registry.filter(['building-ui']);
    const result = injectSkills(skills);

    expect(result).toContain('## Active Skills');
    expect(result).toContain('<skill name="building-ui">');
    expect(result).toContain('Use components for everything.');
    expect(result).toContain('</skill>');
  });

  it('returns empty string for no skills', () => {
    expect(injectSkills([])).toBe('');
  });
});

describe('summarizeSkills', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('summarizes loaded skills', () => {
    const registry = new SkillRegistry({
      workspace: TEST_DIR,
      homeDir: join(TEST_DIR, '__global__'),
    });

    const summary = summarizeSkills(registry.getAll());
    expect(summary).toContain('Loaded 4 skill(s)');
    expect(summary).toContain('building-ui');
  });
});
