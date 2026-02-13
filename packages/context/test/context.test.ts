/**
 * @arcan-os/context — Tests
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentEvent } from '@arcan-os/core';
import { SkillRegistry } from '@arcan-os/skills';
import { ContextAssembler } from '../src/context-assembler.js';
import { projectMessages } from '../src/message-history.js';

const TEST_DIR = join(import.meta.dir, '__test_workspace__');

function setup() {
  // Create a workspace skill
  const skillDir = join(TEST_DIR, '.agent', 'skills', 'test-skill');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---
name: test-skill
description: A test skill
---
# Test Skill

Always use TypeScript.
`,
  );
}

function teardown() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// =========================================================================
// ContextAssembler
// =========================================================================

describe('ContextAssembler', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('builds system prompt with base + workspace + skills', () => {
    const registry = new SkillRegistry({
      workspace: TEST_DIR,
      homeDir: '/tmp/nonexistent',
    });

    const assembler = new ContextAssembler({
      basePrompt: 'You are a helpful coding assistant.',
      skillRegistry: registry,
      workspace: TEST_DIR,
    });

    const prompt = assembler.buildSystemPrompt({
      sessionId: 's1',
      prompt: 'hello',
      skills: ['test-skill'],
    });

    expect(prompt).toContain('You are a helpful coding assistant.');
    expect(prompt).toContain('## Workspace');
    expect(prompt).toContain('## Active Skills');
    expect(prompt).toContain('<skill name="test-skill">');
    expect(prompt).toContain('Always use TypeScript.');
  });

  it('omits skills section when no skills match', () => {
    const registry = new SkillRegistry();

    const assembler = new ContextAssembler({
      basePrompt: 'You are helpful.',
      skillRegistry: registry,
      workspace: TEST_DIR,
    });

    const prompt = assembler.buildSystemPrompt({
      sessionId: 's1',
      prompt: 'hello',
      skills: ['nonexistent'],
    });

    expect(prompt).toContain('You are helpful.');
    expect(prompt).not.toContain('## Active Skills');
  });

  it('assembles a full EngineRunRequest', () => {
    const registry = new SkillRegistry();

    const assembler = new ContextAssembler({
      basePrompt: 'System prompt.',
      skillRegistry: registry,
      workspace: TEST_DIR,
    });

    const request = assembler.assemble({
      runId: 'r1',
      runConfig: { sessionId: 's1', prompt: 'do stuff' },
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    });

    expect(request.systemPrompt).toContain('System prompt.');
    expect(request.messages).toHaveLength(1);
    expect(request.runConfig.prompt).toBe('do stuff');
  });
});

// =========================================================================
// projectMessages
// =========================================================================

describe('projectMessages', () => {
  const makeEvent = (
    type: string,
    payload: unknown,
    seq: number,
  ): AgentEvent => ({
    eventId: `e${seq}`,
    runId: 'r1',
    sessionId: 's1',
    seq,
    ts: Date.now(),
    type: type as AgentEvent['type'],
    payload,
  });

  it('accumulates text deltas into assistant message', () => {
    const events: AgentEvent[] = [
      makeEvent('output.delta', { text: 'Hello ' }, 1),
      makeEvent('output.delta', { text: 'world!' }, 2),
    ];

    const msgs = projectMessages(events);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('assistant');
    expect(msgs[0].content).toBe('Hello world!');
  });

  it('maps tool calls to assistant messages', () => {
    const events: AgentEvent[] = [
      makeEvent(
        'tool.call',
        { callId: 'c1', toolId: 'repo.read', args: { path: 'test.ts' } },
        1,
      ),
      makeEvent(
        'tool.result',
        { callId: 'c1', toolId: 'repo.read', result: 'file contents' },
        2,
      ),
    ];

    const msgs = projectMessages(events);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('assistant');
    expect(msgs[0].toolCallId).toBe('c1');
    expect(msgs[1].role).toBe('tool');
    expect(msgs[1].content).toBe('file contents');
  });

  it('flushes accumulated deltas before tool calls', () => {
    const events: AgentEvent[] = [
      makeEvent('output.delta', { text: 'Let me check...' }, 1),
      makeEvent(
        'tool.call',
        { callId: 'c1', toolId: 'repo.read', args: {} },
        2,
      ),
      makeEvent(
        'tool.result',
        { callId: 'c1', toolId: 'repo.read', result: 'data' },
        3,
      ),
      makeEvent('output.delta', { text: 'Done!' }, 4),
    ];

    const msgs = projectMessages(events);
    expect(msgs).toHaveLength(4);
    expect(msgs[0]).toEqual({ role: 'assistant', content: 'Let me check...' });
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].toolCallId).toBe('c1');
    expect(msgs[2].role).toBe('tool');
    expect(msgs[3]).toEqual({ role: 'assistant', content: 'Done!' });
  });

  it('skips non-message events', () => {
    const events: AgentEvent[] = [
      makeEvent('run.started', {}, 1),
      makeEvent('engine.request', {}, 2),
      makeEvent('output.delta', { text: 'hi' }, 3),
      makeEvent('engine.response', {}, 4),
    ];

    const msgs = projectMessages(events);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('hi');
  });

  it('handles empty event list', () => {
    expect(projectMessages([])).toEqual([]);
  });
});
