# Context Engineering and Agentic Design Guide

**Version**: 1.0.0
**Last Updated**: 2026-02-13
**Target Audience**: AI coding agents, developers building with Arcan OS

---

## Table of Contents

1. [Introduction](#introduction)
2. [Core Principles](#core-principles)
3. [Context Engineering](#context-engineering)
4. [Agentic Design Patterns](#agentic-design-patterns)
5. [Automation & Hooks](#automation--hooks)
6. [Filesystem Organization](#filesystem-organization)
7. [Event-Driven Architecture](#event-driven-architecture)
8. [Tool Design & Safety](#tool-design--safety)
9. [Best Practices Checklist](#best-practices-checklist)
10. [Anti-Patterns & Common Mistakes](#anti-patterns--common-mistakes)
11. [Decision Trees](#decision-trees)
12. [Quick Reference](#quick-reference)

---

## Introduction

This guide is the definitive reference for building AI agent systems using context engineering principles and agentic design patterns. It synthesizes architectural patterns from Arcan OS, industry best practices, and battle-tested approaches to creating safe, observable, and maintainable agent systems.

### What is Context Engineering?

**Context Engineering** is the practice of deliberately structuring, injecting, and managing contextual information that guides AI agent behavior. Instead of relying on prompts alone, context engineering treats the agent's environment as a first-class design concern.

### What is Agentic Design?

**Agentic Design** is the architectural approach to building systems where AI agents can take autonomous actions while remaining safe, observable, and governable. It emphasizes:

- **Separation of reasoning and execution**
- **Event-sourced state management**
- **Capability-based security**
- **Human-in-the-loop approval gates**
- **Immutable audit trails**

---

## Core Principles

### 1. Planner/Executor Split (Non-Negotiable)

The foundational principle of safe agentic systems:

```
┌─────────────────┐         ┌─────────────────┐
│   PLANNER       │         │   EXECUTOR      │
│  (Untrusted)    │────────▶│   (Trusted)     │
│                 │         │                 │
│ • LLM reasoning │         │ • Policy checks │
│ • Tool selection│         │ • Isolation     │
│ • Intent        │         │ • Execution     │
│ • Planning      │         │ • Recording     │
└─────────────────┘         └─────────────────┘
       ▲                            │
       │                            │
       └────────── Events ──────────┘
            (Immutable Log)
```

**Key Rules:**

- The reasoning layer NEVER directly performs side effects
- All actions must pass through the OS via typed tools
- Tools are the security boundary
- Everything is recorded as immutable events

### 2. Everything is an Event

State is not stored—it is derived from an append-only event stream.

```typescript
// ❌ BAD: Mutable state
class Agent {
  private state: { running: boolean; steps: number };

  async execute() {
    this.state.running = true;  // Lost forever
    this.state.steps++;         // No audit trail
  }
}

// ✅ GOOD: Event-sourced
interface AgentEvent {
  eventId: string;
  runId: string;
  sessionId: string;
  seq: number;
  ts: number;
  type: AgentEventType;
  payload: T;
}

// State is a projection
function projectRunState(events: AgentEvent[]): RunState {
  return events.reduce((state, event) => {
    switch (event.type) {
      case 'run.started': return { ...state, status: 'running' };
      case 'run.completed': return { ...state, status: 'completed' };
      default: return state;
    }
  }, initialState);
}
```

**Benefits:**

- **Replay**: Recreate any state from events
- **Debug**: Time-travel through execution
- **Audit**: Immutable proof of what happened
- **Analysis**: Pattern detection, evals, metrics

### 3. Capability-Based Security (Default Deny)

Never trust prompts for security. Use explicit capability grants.

```typescript
interface ToolSpec {
  id: string;
  category: 'read' | 'write' | 'exec' | 'network';
  capabilities: string[];  // ['fs.read', 'fs.write']
  needsApproval: (args: unknown) => boolean;
}

interface PolicyEngine {
  evaluate(tool: string, args: unknown):
    | 'allow'      // Execute immediately
    | 'deny'       // Block
    | 'approval'   // Require human decision
    | 'preview';   // Show preview, then approve
}
```

**Key Principle**: Security by mechanism, not by instruction.

### 4. Context as Configuration

Context is injected through multiple layers, each with specific purposes:

```
┌─────────────────────────────────────────┐
│  System Prompt (Identity & Constraints) │
├─────────────────────────────────────────┤
│  Skills (Domain Knowledge)              │
├─────────────────────────────────────────┤
│  Rules (Project-Specific Conventions)   │
├─────────────────────────────────────────┤
│  Tools (Capabilities)                   │
├─────────────────────────────────────────┤
│  Message History (Conversation State)   │
├─────────────────────────────────────────┤
│  Working Memory (Session State)         │
└─────────────────────────────────────────┘
```

### 5. Observable by Default

Every action must be traceable:

```typescript
// Emit events at key boundaries
async function executeTool(call: ToolCall): Promise<ToolResult> {
  const startTime = Date.now();

  emit({
    type: 'tool.call',
    payload: { callId: call.id, toolId: call.tool, args: call.args }
  });

  try {
    const result = await toolRegistry.execute(call);

    emit({
      type: 'tool.result',
      payload: {
        callId: call.id,
        result,
        durationMs: Date.now() - startTime
      }
    });

    return result;
  } catch (error) {
    emit({
      type: 'tool.failed',
      payload: { callId: call.id, error: String(error) }
    });
    throw error;
  }
}
```

---

## Context Engineering

### Context Hierarchy

Context flows through the system in layers:

#### 1. Static Context (Version-Controlled)

**Location**: `.claude/`, `CLAUDE.md`, `AGENTS.md`, `docs/`

**Purpose**: Persistent project knowledge that rarely changes.

**Examples**:
- Architecture documentation
- Code style guides
- Testing conventions
- Monorepo structure
- Command references

**Best Practices**:

```markdown
# CLAUDE.md Structure

## Project Context
Brief 1-2 sentence description.

## Commands
Executable commands with examples.

## Architecture
High-level system design.

## Style Guide
Language, runtime, conventions.
```

#### 2. Dynamic Context (Runtime-Injected)

**Location**: Skills (`.agent/skills/`, `~/.arcan-os/skills/`)

**Purpose**: Task-specific knowledge injected on-demand.

**Example Skill**:

```markdown
---
name: typescript-refactoring
description: Guidelines for safe TypeScript refactoring
version: 1.0.0
---

# TypeScript Refactoring Skill

When refactoring TypeScript code:

1. **Always run type checker first**: `bun run typecheck`
2. **Use IDE refactoring tools** when possible (rename symbol, extract function)
3. **Update tests alongside code**
4. **Verify build succeeds**: `bun run build`

## Safe Refactoring Patterns

### Renaming
- Use Find/Replace with word boundaries
- Check imports across the monorepo
- Update documentation and comments

### Extracting Functions
- Preserve type signatures
- Maintain error handling
- Keep side effects explicit
```

#### 3. Conversational Context (Message History)

**Location**: In-memory during run, persisted as events

**Purpose**: Track the ongoing conversation and agent actions.

**Implementation**:

```typescript
interface MessageHistory {
  getMessages(runId: string): CoreMessage[];
  addMessage(runId: string, message: CoreMessage): void;
  compact(runId: string, strategy: CompactionStrategy): void;
}

// Project from events
function projectMessageHistory(events: AgentEvent[]): CoreMessage[] {
  const messages: CoreMessage[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'run.started':
        messages.push({
          role: 'user',
          content: event.payload.prompt
        });
        break;

      case 'output.message':
        messages.push({
          role: 'assistant',
          content: event.payload.content
        });
        break;

      case 'tool.call':
        messages.push({
          role: 'assistant',
          content: '',
          toolInvocations: [{
            toolCallId: event.payload.callId,
            toolName: event.payload.toolId,
            args: event.payload.args,
            state: 'call'
          }]
        });
        break;

      case 'tool.result':
        // Append result to last message with matching callId
        break;
    }
  }

  return messages;
}
```

#### 4. Working Memory (Session State)

**Location**: In-memory, snapshotted periodically

**Purpose**: Agent's scratchpad for observations and reflections.

**Schema**:

```typescript
interface WorkingMemory {
  observations: Observation[];  // Facts learned during session
  reflections: Reflection[];    // Insights derived from observations
  goals: Goal[];                // Current objectives
  blockers: Blocker[];          // Issues preventing progress
}

interface Observation {
  id: string;
  timestamp: number;
  type: 'fact' | 'error' | 'success' | 'pattern';
  content: string;
  context: Record<string, unknown>;
}

interface Reflection {
  id: string;
  timestamp: number;
  insight: string;
  basedOn: string[];  // observation IDs
  confidence: number;
}
```

### Context Injection Strategies

#### Skills.sh Compatible Format

Arcan OS uses the skills.sh convention for portability:

```markdown
---
name: skill-name
description: One-line description
version: 1.0.0
triggers:
  - keyword-1
  - keyword-2
---

# Skill Content

Markdown content injected into the LLM context when this skill is loaded.
```

**Discovery Priority**:

1. `.agent/skills/<name>/SKILL.md` (workspace-local, highest priority)
2. `.skills/<name>/SKILL.md` (installed via `npx skills add`)
3. `~/.arcan-os/skills/<name>/SKILL.md` (global user skills)

**Loading**:

```typescript
class SkillLoader {
  async load(workspace: string, skillNames: string[]): Promise<Skill[]> {
    const skills: Skill[] = [];

    for (const name of skillNames) {
      // Check workspace-local first
      const localPath = path.join(workspace, '.agent/skills', name, 'SKILL.md');
      if (await exists(localPath)) {
        skills.push(await parseSkill(localPath));
        continue;
      }

      // Check installed skills
      const installedPath = path.join(workspace, '.skills', name, 'SKILL.md');
      if (await exists(installedPath)) {
        skills.push(await parseSkill(installedPath));
        continue;
      }

      // Check global
      const globalPath = path.join(os.homedir(), '.arcan-os/skills', name, 'SKILL.md');
      if (await exists(globalPath)) {
        skills.push(await parseSkill(globalPath));
      }
    }

    return skills;
  }
}
```

#### Context Compaction

When context grows too large, compact strategically:

```typescript
type CompactionStrategy =
  | 'keep-recent'      // Keep last N messages
  | 'keep-important'   // Keep messages with tool calls
  | 'summarize-early'  // Replace early messages with summary
  | 'checkpoint';      // Create explicit checkpoint, start fresh

async function compactContext(
  runId: string,
  strategy: CompactionStrategy
): Promise<void> {
  const events = await store.getEvents(runId);

  switch (strategy) {
    case 'checkpoint': {
      // Save current state as checkpoint
      const snapshot = projectState(events);
      await store.append({
        type: 'checkpoint.created',
        payload: {
          checkpointId: generateId(),
          summary: summarizeRun(events),
          memorySnapshot: snapshot.memory,
          lastSeq: events[events.length - 1].seq
        }
      });

      // Truncate message history, keep checkpoint reference
      break;
    }

    // ... other strategies
  }
}
```

---

## Agentic Design Patterns

### Pattern 1: Tool Loop Agent

The fundamental agent pattern—an LLM that can call tools and continue until complete.

**Implementation with AI SDK**:

```typescript
import { streamText } from 'ai';

async function* runToolLoopAgent(request: RunRequest) {
  const stream = streamText({
    model: anthropic('claude-3-5-sonnet-20241022'),
    messages: request.messages,
    tools: toolRegistry.getTools(),
    maxSteps: 25,  // Multi-step agent loop

    // Policy-based approval gate
    needsApproval: ({ toolName, args }) => {
      return toolKernel.needsApproval(toolName, args);
    },

    // Telemetry
    experimental_telemetry: {
      isEnabled: true,
      functionId: request.runId
    }
  });

  // Bridge AI SDK events to AgentEvents
  for await (const part of stream.fullStream) {
    yield mapToAgentEvent(part);
  }
}
```

**Key Features**:

- LLM decides tool usage
- Automatic multi-step reasoning
- Built-in approval gates
- Telemetry for observability

### Pattern 2: Memory-Augmented Agent

Agents that learn and remember across turns.

```typescript
class MemoryService {
  async observe(runId: string, startSeq: number): Promise<void> {
    const events = await store.getEvents(runId, { fromSeq: startSeq });
    const observations = this.extractObservations(events);

    // Store in working memory
    await this.storeObservations(runId, observations);

    // Emit event
    await store.append({
      type: 'memory.observed',
      payload: {
        observations,
        processedSeqRange: { start: startSeq, end: events[events.length - 1].seq }
      }
    });
  }

  async reflect(runId: string): Promise<void> {
    const observations = await this.getObservations(runId);
    const reflections = await this.generateReflections(observations);

    await store.append({
      type: 'memory.reflected',
      payload: { reflections }
    });
  }

  private extractObservations(events: AgentEvent[]): Observation[] {
    const observations: Observation[] = [];

    for (const event of events) {
      switch (event.type) {
        case 'tool.result':
          if (event.payload.result.error) {
            observations.push({
              type: 'error',
              content: `Tool ${event.payload.toolId} failed: ${event.payload.result.error}`,
              context: { toolId: event.payload.toolId }
            });
          }
          break;

        case 'run.completed':
          observations.push({
            type: 'success',
            content: `Run completed successfully in ${event.payload.totalSteps} steps`,
            context: { totalSteps: event.payload.totalSteps }
          });
          break;
      }
    }

    return observations;
  }
}
```

**Usage**:

```typescript
// After each run segment
await memoryService.observe(runId, lastProcessedSeq);

// Periodically reflect
if (shouldReflect(runId)) {
  await memoryService.reflect(runId);
}

// Inject memory into next run
const memory = await memoryService.getMemory(sessionId);
const contextWithMemory = assembleContext({
  ...baseContext,
  workingMemory: memory
});
```

### Pattern 3: Approval-Gated Execution

Human-in-the-loop for high-risk operations.

```typescript
interface ApprovalGate {
  requestApproval(request: ApprovalRequest): Promise<string>;
  resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<void>;
  waitForApproval(approvalId: string): Promise<ApprovalDecision>;
}

class DefaultApprovalGate implements ApprovalGate {
  private pendingApprovals = new Map<string, Deferred<ApprovalDecision>>();

  async requestApproval(request: ApprovalRequest): Promise<string> {
    const approvalId = generateId();
    const deferred = createDeferred<ApprovalDecision>();

    this.pendingApprovals.set(approvalId, deferred);

    // Emit event
    await store.append({
      type: 'approval.requested',
      payload: {
        approvalId,
        callId: request.callId,
        toolId: request.toolId,
        args: request.args,
        preview: request.preview,
        risk: request.risk
      }
    });

    // Pause the run
    await runManager.pauseRun(request.runId, {
      reason: 'approval',
      approvalId
    });

    return approvalId;
  }

  async resolveApproval(
    approvalId: string,
    decision: ApprovalDecision
  ): Promise<void> {
    const deferred = this.pendingApprovals.get(approvalId);
    if (!deferred) throw new Error(`Unknown approval: ${approvalId}`);

    // Emit event
    await store.append({
      type: 'approval.resolved',
      payload: {
        approvalId,
        decision: decision.decision,
        reason: decision.reason,
        resolvedBy: decision.resolvedBy
      }
    });

    // Resolve the promise
    deferred.resolve(decision);
    this.pendingApprovals.delete(approvalId);

    // Resume the run
    const approval = await this.getApproval(approvalId);
    await runManager.resumeRun(approval.runId, { resumedFrom: 'approval' });
  }

  async waitForApproval(approvalId: string): Promise<ApprovalDecision> {
    const deferred = this.pendingApprovals.get(approvalId);
    if (!deferred) throw new Error(`Unknown approval: ${approvalId}`);
    return deferred.promise;
  }
}
```

**Integration with AI SDK**:

```typescript
streamText({
  needsApproval: async ({ toolName, args }) => {
    const decision = await policyEngine.evaluate(toolName, args);

    if (decision === 'allow') {
      return false;  // No approval needed
    }

    if (decision === 'deny') {
      throw new Error(`Policy blocked tool: ${toolName}`);
    }

    // Request approval
    const approvalId = await approvalGate.requestApproval({
      toolId: toolName,
      args,
      risk: analyzeRisk(toolName, args)
    });

    // Wait for human decision
    const result = await approvalGate.waitForApproval(approvalId);

    if (result.decision === 'deny') {
      throw new Error(`Approval denied: ${result.reason}`);
    }

    return false;  // Approved, proceed
  }
});
```

### Pattern 4: Skill-Based Specialization

Load domain expertise dynamically.

```typescript
interface SkillRegistry {
  discover(workspace: string): Promise<string[]>;
  load(skillNames: string[]): Promise<Skill[]>;
  inject(skills: Skill[], context: Context): Context;
}

// Usage
const requestedSkills = request.skills || [];
const availableSkills = await skillRegistry.discover(workspace);
const skillsToLoad = requestedSkills.filter(s => availableSkills.includes(s));
const skills = await skillRegistry.load(skillsToLoad);

const context = skillRegistry.inject(skills, baseContext);

// Skills become part of system instructions
const systemMessage = {
  role: 'system',
  content: [
    baseInstructions,
    ...skills.map(s => s.content)
  ].join('\n\n---\n\n')
};
```

### Pattern 5: Session-Scoped Runs

One active run per session, with queuing.

```typescript
class SessionQueue {
  private activeRuns = new Map<string, string>();  // sessionId -> runId
  private queued = new Map<string, RunRequest[]>(); // sessionId -> requests

  async enqueue(sessionId: string, request: RunRequest): Promise<string> {
    // If session has active run, queue this request
    if (this.activeRuns.has(sessionId)) {
      const queue = this.queued.get(sessionId) || [];
      queue.push(request);
      this.queued.set(sessionId, queue);

      return 'queued';
    }

    // Mark session as active
    const runId = generateId();
    this.activeRuns.set(sessionId, runId);

    return runId;
  }

  async complete(sessionId: string, runId: string): Promise<void> {
    // Remove active run
    this.activeRuns.delete(sessionId);

    // Check for queued requests
    const queue = this.queued.get(sessionId) || [];
    if (queue.length > 0) {
      const nextRequest = queue.shift()!;
      this.queued.set(sessionId, queue);

      // Start next run
      await this.enqueue(sessionId, nextRequest);
    }
  }
}
```

---

## Automation & Hooks

### Hook System Overview

Hooks inject behavior at specific lifecycle points:

```typescript
type HookType =
  | 'SessionStart'          // New session begins
  | 'SessionStart:compact'  // Session starts after context compaction
  | 'UserPromptSubmit'      // User submits a prompt
  | 'PostToolUse'           // After tool execution
  | 'Stop'                  // Agent stops (complete/failed/paused)
  | 'PreCommit';            // Before git commit (if enabled)

interface Hook {
  type: HookType;
  condition?: (context: HookContext) => boolean;
  action: (context: HookContext) => Promise<void>;
}
```

### Common Hook Patterns

#### 1. Auto-Format on Write/Edit

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "condition": {
          "toolName": ["Write", "Edit"]
        },
        "command": "bunx biome check --write ."
      }
    ]
  }
}
```

**Effect**: Every file write/edit triggers automatic formatting.

#### 2. Re-inject Context After Compaction

```json
{
  "hooks": {
    "SessionStart:compact": [
      {
        "action": "inject",
        "content": "file:///.claude/session-start.md"
      }
    ]
  }
}
```

**session-start.md**:

```markdown
# Session Resumed

You are continuing work on Arcan OS, an event-sourced agent runtime.

## Key Conventions

- Event-sourced: All state is derived from events
- TypeScript strict mode
- Bun for package management and testing
- Biome for linting and formatting

## Before Committing

Run these commands:
1. `bunx biome check --write .`
2. `bun run typecheck`
3. `bun test` (for larger changes)
```

#### 3. Task Tracking on Prompt Submit

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "action": "log",
        "message": "New task started: {{prompt}}"
      }
    ]
  }
}
```

#### 4. Quality Checks on Stop

```json
{
  "hooks": {
    "Stop": [
      {
        "action": "remind",
        "message": "Before committing:\n1. Verify formatting: bunx biome check .\n2. Verify types: bun run typecheck\n3. Verify tests: bun test"
      }
    ]
  }
}
```

### Hook Configuration Best Practices

**Location**: `.claude/settings.local.json` (gitignored for user customization)

**Structure**:

```json
{
  "permissions": {
    "allow": [
      { "command": "bun", "args": ["test"] },
      { "command": "bun", "args": ["run", "typecheck"] },
      { "command": "bunx", "args": ["biome", "check", "--write", "."] }
    ],
    "deny": [
      { "path": ".env*" },
      { "path": "**/secrets/**" },
      { "path": ".git/config" }
    ]
  },

  "hooks": {
    "SessionStart:compact": [
      { "action": "inject", "content": "file:///.claude/session-start.md" }
    ],

    "PostToolUse": [
      {
        "condition": { "toolName": ["Write", "Edit"] },
        "command": "bunx biome check --write ."
      }
    ],

    "Stop": [
      {
        "action": "remind",
        "message": "Verify: formatting, types, tests"
      }
    ]
  }
}
```

---

## Filesystem Organization

### Standard Layout

```
project-root/
├── .agent/                    # Agent-specific (gitignored)
│   ├── state/                 # Session state, working memory
│   └── skills/                # Workspace-local skills (highest priority)
│
├── .claude/                   # Claude Code configuration
│   ├── settings.local.json    # Permissions, hooks (gitignored)
│   ├── commands/              # Custom slash commands
│   │   └── review.md
│   └── rules/                 # Topic-specific guidelines
│       ├── code-style.md
│       ├── testing.md
│       └── monorepo.md
│
├── .skills/                   # Installed skills (via npx skills add)
│   └── typescript-refactoring/
│       └── SKILL.md
│
├── docs/                      # Architecture documentation
│   ├── ARCHITECTURE.md
│   └── CONTEXT_ENGINEERING_GUIDE.md  # This file
│
├── CLAUDE.md                  # Quick reference for Claude Code
├── AGENTS.md                  # Deep dive for AI assistants
├── README.md                  # Public project documentation
│
├── apps/                      # Applications
│   └── arcand/                # Daemon (HTTP/SSE server)
│
└── packages/                  # Shared libraries
    ├── core/                  # Foundation types
    ├── event-store/           # SQLite event ledger
    ├── tool-kernel/           # Tools and policy engine
    └── ...
```

### File Purposes

| File | Purpose | Audience |
|------|---------|----------|
| `CLAUDE.md` | Quick reference, commands, project context | Claude Code agent |
| `AGENTS.md` | Deep architectural knowledge, conventions | All AI coding assistants |
| `.claude/rules/*.md` | Topic-specific guidelines | Claude Code (auto-injected) |
| `.agent/skills/*/SKILL.md` | Workspace-local domain skills | Agent at runtime |
| `docs/*.md` | Long-form architecture docs | Humans + agents (on-demand) |
| `README.md` | Public project overview | External users, contributors |

### Skills Directory Structure

```
~/.arcan-os/skills/           # Global user skills
├── typescript-refactoring/
│   ├── SKILL.md
│   └── examples/
│       └── safe-rename.ts
│
└── testing-patterns/
    ├── SKILL.md
    └── templates/
        └── integration.test.ts

.skills/                       # Installed skills (project-local)
└── expo-best-practices/
    └── SKILL.md

.agent/skills/                 # Workspace-specific (highest priority)
└── arcan-os-conventions/
    └── SKILL.md
```

**Discovery Order** (highest priority first):

1. `.agent/skills/<name>/SKILL.md`
2. `.skills/<name>/SKILL.md`
3. `~/.arcan-os/skills/<name>/SKILL.md`

### Version Control Guidelines

**.gitignore**:

```gitignore
# Agent state (ephemeral)
.agent/state/
.agent/cache/

# User-specific settings
.claude/settings.local.json

# Workspace-specific skills (may contain secrets)
.agent/skills/

# Build artifacts
dist/
*.tsbuildinfo

# Secrets
.env*
!.env.example
secrets/
```

**Commit to version control**:

- `.claude/rules/*.md` (project conventions)
- `.claude/commands/*.md` (team slash commands)
- `CLAUDE.md`, `AGENTS.md` (agent instructions)
- `docs/*.md` (architecture documentation)
- `.skills/*/SKILL.md` (installed, team-shared skills)

---

## Event-Driven Architecture

### Event Schema Design

**Envelope** (every event):

```typescript
interface AgentEvent<T = unknown> {
  eventId: string;      // ULID (sortable, unique)
  runId: string;        // Which run this belongs to
  sessionId: string;    // Which session this belongs to
  seq: number;          // Monotonic sequence (1, 2, 3, ...)
  ts: number;           // Unix timestamp (milliseconds)
  type: AgentEventType; // Discriminated union
  payload: T;           // Type-specific data
}
```

**Event Types** (organize by domain):

```typescript
type AgentEventType =
  // Run lifecycle
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'run.paused'
  | 'run.resumed'

  // Output
  | 'output.delta'
  | 'output.message'

  // Tool execution
  | 'tool.call'
  | 'tool.result'

  // Approval gate
  | 'approval.requested'
  | 'approval.resolved'

  // Artifacts
  | 'artifact.emitted'

  // Checkpoints
  | 'checkpoint.created'
  | 'state.snapshot'

  // Engine observability
  | 'engine.request'
  | 'engine.response'

  // Memory
  | 'working_memory.snapshot'
  | 'memory.observed'
  | 'memory.reflected';
```

### Event Store Implementation

```typescript
interface EventStore {
  // Append-only write
  append(events: AgentEvent | AgentEvent[]): Promise<void>;

  // Query by run/session
  getEvents(
    runId: string,
    options?: { fromSeq?: number; toSeq?: number }
  ): Promise<AgentEvent[]>;

  getEventsBySession(sessionId: string): Promise<AgentEvent[]>;

  // Streaming (for SSE)
  subscribe(
    runId: string,
    fromSeq?: number
  ): AsyncIterableIterator<AgentEvent>;

  // Snapshots (optional optimization)
  saveSnapshot(snapshot: StateSnapshot): Promise<void>;
  getLatestSnapshot(sessionId: string): Promise<StateSnapshot | null>;
}
```

**SQLite Schema**:

```sql
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,  -- JSON

  UNIQUE(run_id, seq)
);

CREATE INDEX idx_events_run ON events(run_id, seq);
CREATE INDEX idx_events_session ON events(session_id, ts);
CREATE INDEX idx_events_type ON events(type, ts);

-- Snapshots table (optional)
CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  last_seq INTEGER NOT NULL,
  snapshot_type TEXT NOT NULL,
  data TEXT NOT NULL,  -- JSON
  created_at INTEGER NOT NULL
);
```

### State Projection Patterns

**Pattern 1: Reduce over events**

```typescript
function projectRunState(events: AgentEvent[]): RunState {
  return events.reduce((state, event) => {
    switch (event.type) {
      case 'run.started':
        return {
          ...state,
          status: 'running',
          startedAt: event.ts,
          prompt: event.payload.prompt
        };

      case 'run.completed':
        return {
          ...state,
          status: 'completed',
          completedAt: event.ts,
          summary: event.payload.summary
        };

      case 'run.failed':
        return {
          ...state,
          status: 'failed',
          failedAt: event.ts,
          error: event.payload.error
        };

      case 'tool.call':
        return {
          ...state,
          toolCalls: [
            ...state.toolCalls,
            {
              id: event.payload.callId,
              tool: event.payload.toolId,
              args: event.payload.args,
              status: 'pending'
            }
          ]
        };

      case 'tool.result':
        return {
          ...state,
          toolCalls: state.toolCalls.map(call =>
            call.id === event.payload.callId
              ? { ...call, result: event.payload.result, status: 'completed' }
              : call
          )
        };

      default:
        return state;
    }
  }, initialRunState);
}
```

**Pattern 2: Incremental projection with snapshots**

```typescript
async function getRunState(runId: string): Promise<RunState> {
  // Try to load snapshot first
  const snapshot = await store.getLatestSnapshot(runId);

  if (snapshot) {
    // Load only events after snapshot
    const events = await store.getEvents(runId, {
      fromSeq: snapshot.lastSeq + 1
    });

    // Project from snapshot
    return projectRunState(events, snapshot.data as RunState);
  }

  // No snapshot, project from beginning
  const events = await store.getEvents(runId);
  return projectRunState(events);
}

// Periodically save snapshots
async function snapshotIfNeeded(runId: string): Promise<void> {
  const events = await store.getEvents(runId);

  // Snapshot every 100 events
  if (events.length % 100 === 0) {
    const state = projectRunState(events);
    await store.saveSnapshot({
      snapshotId: generateId(),
      runId,
      lastSeq: events[events.length - 1].seq,
      snapshotType: 'run',
      data: state,
      createdAt: now()
    });
  }
}
```

### Event Streaming (SSE)

```typescript
// Elysia route
app.get('/v1/runs/:runId/events', async ({ params, request }) => {
  const { runId } = params;
  const lastEventId = request.headers.get('Last-Event-ID');

  // Determine starting sequence
  const fromSeq = lastEventId
    ? Number.parseInt(lastEventId) + 1
    : 0;

  // Create SSE stream
  return new Response(
    new ReadableStream({
      async start(controller) {
        // Send historical events
        const historical = await store.getEvents(runId, { fromSeq });
        for (const event of historical) {
          controller.enqueue(formatSSE(event));
        }

        // Subscribe to new events
        for await (const event of store.subscribe(runId, fromSeq)) {
          controller.enqueue(formatSSE(event));

          // Close stream on terminal events
          if (['run.completed', 'run.failed'].includes(event.type)) {
            controller.close();
            break;
          }
        }
      }
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    }
  );
});

function formatSSE(event: AgentEvent): string {
  return [
    `id: ${event.seq}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify(event)}`,
    '',
    ''
  ].join('\n');
}
```

---

## Tool Design & Safety

### Tool Anatomy

```typescript
interface ToolHandler<TInput = unknown, TOutput = unknown> {
  // Metadata
  id: string;                    // 'repo.read', 'process.run'
  description: string;           // For LLM tool selection
  version: string;               // Semantic version

  // Schema
  inputSchema: z.ZodSchema<TInput>;
  outputSchema?: z.ZodSchema<TOutput>;

  // Security
  category: 'read' | 'write' | 'exec' | 'network';
  capabilities: string[];        // ['fs.read', 'fs.write']
  isolation?: IsolationProfile;  // Container, WASM, etc.

  // Execution
  execute(input: TInput, context: ToolContext): Promise<TOutput>;

  // Observability
  timeout?: number;              // Default timeout in ms
  retryPolicy?: RetryPolicy;
  redactionRules?: RedactionRule[];
}
```

### Example Tool: repo.search

```typescript
import { z } from 'zod';

const repoSearchInput = z.object({
  pattern: z.string().describe('Regex pattern to search for'),
  glob: z.string().optional().describe('File glob pattern (e.g., "*.ts")'),
  caseSensitive: z.boolean().default(false)
});

type RepoSearchInput = z.infer<typeof repoSearchInput>;

interface RepoSearchOutput {
  matches: Array<{
    file: string;
    line: number;
    content: string;
  }>;
  totalMatches: number;
}

export const repoSearchTool: ToolHandler<RepoSearchInput, RepoSearchOutput> = {
  id: 'repo.search',
  description: 'Search for code patterns across the repository using regex',
  version: '1.0.0',

  inputSchema: repoSearchInput,

  category: 'read',
  capabilities: ['fs.read'],

  timeout: 30000,  // 30 seconds

  async execute(input, context) {
    const startTime = Date.now();

    // Build ripgrep command
    const args = [
      input.pattern,
      context.workspace,
      '--json'
    ];

    if (input.glob) {
      args.push('--glob', input.glob);
    }

    if (!input.caseSensitive) {
      args.push('--ignore-case');
    }

    // Execute with timeout
    const proc = Bun.spawn(['rg', ...args], {
      stdout: 'pipe',
      stderr: 'pipe'
    });

    const output = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    // Parse JSON output
    const matches = stdout
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(item => item.type === 'match')
      .map(item => ({
        file: item.data.path.text,
        line: item.data.line_number,
        content: item.data.lines.text.trim()
      }));

    return {
      matches,
      totalMatches: matches.length
    };
  }
};
```

### Policy Engine

```typescript
interface PolicyEngine {
  evaluate(
    toolId: string,
    args: unknown,
    context: PolicyContext
  ): PolicyDecision;
}

type PolicyDecision =
  | 'allow'      // Execute immediately
  | 'deny'       // Block execution
  | 'approval'   // Require human approval
  | 'preview';   // Show preview, then require approval

class DefaultPolicyEngine implements PolicyEngine {
  constructor(
    private config: PolicyConfig
  ) {}

  evaluate(toolId: string, args: unknown, context: PolicyContext): PolicyDecision {
    const tool = context.toolRegistry.get(toolId);
    if (!tool) return 'deny';

    // Check category-based rules
    const categoryRule = this.config.categories[tool.category];
    if (categoryRule === 'deny') return 'deny';
    if (categoryRule === 'approval') return 'approval';

    // Check tool-specific rules
    const toolRule = this.config.tools[toolId];
    if (toolRule) return toolRule;

    // Check risk factors
    const risk = this.analyzeRisk(tool, args);

    if (risk.touchesSecrets || risk.touchesConfig) {
      return 'approval';
    }

    if (risk.estimatedImpact === 'large') {
      return 'preview';
    }

    // Default to allow for read operations
    if (tool.category === 'read') {
      return 'allow';
    }

    // Default to approval for write/exec
    return 'approval';
  }

  private analyzeRisk(
    tool: ToolHandler,
    args: unknown
  ): RiskProfile {
    return {
      toolId: tool.id,
      category: tool.category,
      estimatedImpact: this.estimateImpact(tool, args),
      touchesSecrets: this.touchesSecrets(args),
      touchesConfig: this.touchesConfig(args),
      touchesBuild: this.touchesBuild(args)
    };
  }

  private estimateImpact(tool: ToolHandler, args: any): 'small' | 'medium' | 'large' {
    // Heuristics for impact estimation
    if (tool.category === 'read') return 'small';

    if (tool.id === 'process.run') {
      // Check if command is destructive
      const cmd = args.command as string;
      if (cmd.includes('rm -rf') || cmd.includes('DROP TABLE')) {
        return 'large';
      }
    }

    if (tool.id === 'repo.patch') {
      // Check number of files affected
      const fileCount = args.edits?.length || 0;
      if (fileCount > 10) return 'large';
      if (fileCount > 3) return 'medium';
    }

    return 'medium';
  }

  private touchesSecrets(args: any): boolean {
    const str = JSON.stringify(args);
    return /\.env|secret|credential|api[_-]?key/i.test(str);
  }

  private touchesConfig(args: any): boolean {
    const str = JSON.stringify(args);
    return /package\.json|tsconfig|\.git\/config|biome\.json/i.test(str);
  }

  private touchesBuild(args: any): boolean {
    const str = JSON.stringify(args);
    return /dist\/|build\/|\.tsbuildinfo|node_modules/i.test(str);
  }
}
```

### Tool Registration

```typescript
class ToolKernel {
  private tools = new Map<string, ToolHandler>();

  register(tool: ToolHandler): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool already registered: ${tool.id}`);
    }

    this.tools.set(tool.id, tool);
  }

  async execute(
    callId: string,
    toolId: string,
    args: unknown,
    context: ToolContext
  ): Promise<unknown> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolId}`);
    }

    // Validate input
    const parsed = tool.inputSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(`Invalid input: ${parsed.error.message}`);
    }

    // Check policy
    const decision = this.policyEngine.evaluate(toolId, args, context);

    if (decision === 'deny') {
      throw new Error(`Policy blocked tool: ${toolId}`);
    }

    if (decision === 'approval' || decision === 'preview') {
      // Request approval (handled by approval gate)
      const approvalId = await this.approvalGate.requestApproval({
        callId,
        toolId,
        args,
        risk: this.analyzeRisk(tool, args)
      });

      const approval = await this.approvalGate.waitForApproval(approvalId);

      if (approval.decision === 'deny') {
        throw new Error(`Approval denied: ${approval.reason}`);
      }
    }

    // Execute with timeout
    const result = await this.executeWithTimeout(
      tool,
      parsed.data,
      context,
      tool.timeout || 60000
    );

    // Validate output
    if (tool.outputSchema) {
      return tool.outputSchema.parse(result);
    }

    return result;
  }

  private async executeWithTimeout<T>(
    tool: ToolHandler<unknown, T>,
    args: unknown,
    context: ToolContext,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      tool.execute(args, context),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool timeout: ${tool.id}`)), timeoutMs)
      )
    ]);
  }
}
```

---

## Best Practices Checklist

### For Context Engineering

- [ ] **Static context is version-controlled** (CLAUDE.md, AGENTS.md, .claude/rules/)
- [ ] **Skills follow skills.sh format** (YAML frontmatter + markdown content)
- [ ] **Context has clear hierarchy** (system → skills → rules → history → memory)
- [ ] **Skills are discoverable** (workspace → installed → global)
- [ ] **Context compaction strategy is defined** (checkpoint, summarize, keep-recent)
- [ ] **Session-start hooks re-inject conventions** after compaction

### For Event-Driven Design

- [ ] **All state changes produce events** (no silent mutations)
- [ ] **Events are append-only** (never update or delete)
- [ ] **Events have unique IDs** (ULID for sortability)
- [ ] **Events have monotonic sequences** (per run: 1, 2, 3, ...)
- [ ] **State is projected from events** (reduce pattern)
- [ ] **Snapshots optimize projection** (don't replay from beginning every time)
- [ ] **Event types are well-organized** (by domain: run.*, tool.*, approval.*)

### For Tool Design

- [ ] **Tools have clear input/output schemas** (Zod)
- [ ] **Tools declare capabilities** (['fs.read', 'fs.write'])
- [ ] **Tools are categorized** (read/write/exec/network)
- [ ] **Tools have timeouts** (prevent hanging)
- [ ] **Tool execution is traced** (emit tool.call and tool.result events)
- [ ] **Policy engine controls execution** (allow/deny/approval)
- [ ] **High-risk tools require approval** (write/exec categories)

### For Agentic Systems

- [ ] **Planner and executor are separated** (LLM proposes, OS executes)
- [ ] **Agent loop uses AI SDK's maxSteps** (not custom loops)
- [ ] **Approval gates pause execution** (needsApproval callback)
- [ ] **Memory is structured** (observations + reflections)
- [ ] **Sessions have run queues** (one active run per session)
- [ ] **Telemetry is enabled** (OpenTelemetry + LangSmith)

### For Code Quality

- [ ] **TypeScript strict mode enabled** ("strict": true)
- [ ] **All code passes linting** (bunx biome check .)
- [ ] **All code passes type checking** (bun run typecheck)
- [ ] **New features have tests** (bun test)
- [ ] **Pre-commit hooks prevent broken commits** (format + typecheck)
- [ ] **Build succeeds** (bun run build)

---

## Anti-Patterns & Common Mistakes

### Anti-Pattern 1: Security by Prompt

**Bad**:

```
System: "Never delete files without asking first"
```

**Problem**: Prompts can be overridden, ignored, or bypassed. Security must be enforced mechanically.

**Good**:

```typescript
const policyEngine = new PolicyEngine({
  categories: {
    write: 'approval',  // Always require approval for writes
    exec: 'approval',
    read: 'allow'
  }
});
```

### Anti-Pattern 2: Mutable State

**Bad**:

```typescript
class Agent {
  private state = { step: 0, status: 'idle' };

  async run() {
    this.state.status = 'running';  // Lost forever
    this.state.step++;              // Can't replay
  }
}
```

**Good**:

```typescript
await store.append({
  type: 'run.started',
  payload: { ... }
});

// State is derived
const state = projectRunState(await store.getEvents(runId));
```

### Anti-Pattern 3: Implicit Context

**Bad**:

```
// Context injected via prompt engineering alone
const prompt = `You are a coding assistant. Follow these rules: 1. Always format code. 2. ...`
```

**Problem**:
- Rules get lost in compaction
- No versioning or change tracking
- Hard to maintain as system grows

**Good**:

```markdown
# .claude/rules/code-style.md
## Formatting
Always run `bunx biome check --write .` after modifying code.

# .claude/settings.local.json
{
  "hooks": {
    "PostToolUse": [
      {
        "condition": { "toolName": ["Write", "Edit"] },
        "command": "bunx biome check --write ."
      }
    ]
  }
}
```

### Anti-Pattern 4: Unstructured Memory

**Bad**:

```
System: "Remember these facts: ..."
```

**Problem**:
- No structure for retrieval
- Can't distinguish observations from reflections
- Memory competes with context limits

**Good**:

```typescript
interface WorkingMemory {
  observations: Observation[];  // What happened
  reflections: Reflection[];    // What it means
  goals: Goal[];                // What we're trying to do
  blockers: Blocker[];          // What's preventing progress
}

// Queryable, structured, versioned
```

### Anti-Pattern 5: Custom Agent Loops

**Bad**:

```typescript
async function agentLoop() {
  while (!done) {
    const response = await llm.generate(messages);
    if (response.toolCalls) {
      for (const call of response.toolCalls) {
        const result = await executeTool(call);
        messages.push({ role: 'tool', content: result });
      }
    } else {
      done = true;
    }
  }
}
```

**Problem**:
- Reinvents the wheel
- Misses AI SDK features (streaming, approval, telemetry)
- Hard to maintain

**Good**:

```typescript
const stream = streamText({
  model,
  messages,
  tools,
  maxSteps: 25,  // Built-in multi-step loop
  needsApproval,
  experimental_telemetry: { isEnabled: true }
});
```

### Anti-Pattern 6: Ignoring Event Ordering

**Bad**:

```typescript
// Race condition: events might not be in order
await Promise.all([
  store.append({ type: 'tool.call', seq: 1 }),
  store.append({ type: 'tool.result', seq: 2 })
]);
```

**Good**:

```typescript
// Sequential append preserves order
await store.append({ type: 'tool.call', seq: 1 });
await store.append({ type: 'tool.result', seq: 2 });

// Or batch with guaranteed ordering
await store.append([
  { type: 'tool.call', seq: 1 },
  { type: 'tool.result', seq: 2 }
]);
```

### Anti-Pattern 7: Over-Automating Hooks

**Bad**:

```json
{
  "hooks": {
    "PostToolUse": [
      { "command": "bun run build" },         // Every file change
      { "command": "bun test" },               // Rebuilds + runs tests
      { "command": "git commit -am 'auto'" }   // Auto-commits!
    ]
  }
}
```

**Problem**:
- Extremely slow (every edit triggers full build + tests)
- Auto-commits bypass review
- User loses control

**Good**:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "condition": { "toolName": ["Write", "Edit"] },
        "command": "bunx biome check --write ."  // Fast, safe
      }
    ],
    "Stop": [
      {
        "action": "remind",
        "message": "Run tests before committing: bun test"
      }
    ]
  }
}
```

---

## Decision Trees

### When to Use an Approval Gate

```
Is the tool call...
│
├─ Reading data only? ───────────────────► ALLOW
│
├─ Writing < 3 files?
│  ├─ In test directory? ─────────────────► ALLOW
│  ├─ Touches config/secrets? ────────────► REQUIRE APPROVAL
│  └─ Otherwise ──────────────────────────► PREVIEW + APPROVE
│
├─ Writing > 10 files? ──────────────────► REQUIRE APPROVAL
│
├─ Executing commands?
│  ├─ Read-only (git status, ls)? ────────► ALLOW
│  ├─ Destructive (rm, DROP)? ────────────► REQUIRE APPROVAL
│  └─ Build/test commands? ───────────────► ALLOW
│
└─ Network requests? ────────────────────► REQUIRE APPROVAL
```

### When to Create a Checkpoint

```
Should I create a checkpoint?
│
├─ Major milestone reached? ─────────────► YES
│  (e.g., feature complete, tests pass)
│
├─ Before risky operation? ──────────────► YES
│  (e.g., large refactor, schema change)
│
├─ Context getting large (>100 messages)?─► YES
│
├─ Session switching topics? ────────────► YES
│
└─ Otherwise ────────────────────────────► NO
   (normal incremental work)
```

### Which Context Layer to Use

```
What type of information?
│
├─ Rarely changes, applies to all work?
│  └─► Use CLAUDE.md or AGENTS.md
│
├─ Topic-specific (code style, testing)?
│  └─► Use .claude/rules/<topic>.md
│
├─ Domain expertise, injected on demand?
│  └─► Use skills (.agent/skills/)
│
├─ Session-specific observations?
│  └─► Use working memory
│
└─ Conversation state?
   └─► Use message history (event-sourced)
```

---

## Quick Reference

### Event Types by Use Case

| Use Case | Event Type |
|----------|------------|
| Run started | `run.started` |
| Run finished successfully | `run.completed` |
| Run failed with error | `run.failed` |
| Run paused for approval | `run.paused` |
| Run resumed after approval | `run.resumed` |
| Agent output (streaming) | `output.delta` |
| Agent output (complete message) | `output.message` |
| Tool invoked | `tool.call` |
| Tool returned result | `tool.result` |
| Approval requested | `approval.requested` |
| Approval decision made | `approval.resolved` |
| Artifact created | `artifact.emitted` |
| Checkpoint created | `checkpoint.created` |
| Memory observations extracted | `memory.observed` |
| Memory reflections generated | `memory.reflected` |

### Tool Categories & Default Policies

| Category | Examples | Default Policy |
|----------|----------|----------------|
| `read` | repo.read, repo.search | `allow` |
| `write` | repo.patch, file.write | `approval` or `preview` |
| `exec` | process.run, shell.exec | `approval` |
| `network` | http.fetch, api.call | `approval` |

### Skill Discovery Paths (Priority Order)

1. `.agent/skills/<name>/SKILL.md` (workspace-local, highest priority)
2. `.skills/<name>/SKILL.md` (installed via `npx skills add`)
3. `~/.arcan-os/skills/<name>/SKILL.md` (global user skills)

### Pre-Commit Commands

```bash
# Always run before committing
bunx biome check --write .   # Format and lint
bun run typecheck             # Verify types

# For larger changes
bun test                      # Verify tests pass
bun run build                 # Verify build succeeds
```

### Common Hook Patterns

```json
{
  "hooks": {
    "SessionStart:compact": [
      { "action": "inject", "content": "file:///.claude/session-start.md" }
    ],

    "PostToolUse": [
      {
        "condition": { "toolName": ["Write", "Edit"] },
        "command": "bunx biome check --write ."
      }
    ],

    "Stop": [
      { "action": "remind", "message": "Verify: format, types, tests" }
    ]
  }
}
```

### State Projection Pattern

```typescript
function projectState<T>(
  events: AgentEvent[],
  initialState: T
): T {
  return events.reduce((state, event) => {
    switch (event.type) {
      case 'event.type1':
        return { ...state, /* changes */ };
      case 'event.type2':
        return { ...state, /* changes */ };
      default:
        return state;
    }
  }, initialState);
}
```

### Policy Decision Flow

```
Tool Call Request
      ↓
[Policy Engine]
      ↓
   Decision?
      ├─ allow ──────────────────► Execute
      ├─ deny ───────────────────► Throw Error
      ├─ approval ───────────────► Request Approval → Wait → Execute or Deny
      └─ preview ────────────────► Show Preview → Request Approval → Execute or Deny
```

### Monorepo Package Hierarchy

```
@arcan-os/core (foundation, zero dependencies)
    ↑
    ├─ @arcan-os/event-store
    │      ↑
    │      └─ @arcan-os/run-manager
    │
    ├─ @arcan-os/tool-kernel
    │      ↑
    │      └─ @arcan-os/arcand (integration)
    │
    └─ @arcan-os/engine-adapter
           ↑
           ├─ @arcan-os/context
           │      ↑
           │      └─ @arcan-os/skills
           │
           └─ @arcan-os/observability
```

### File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Source files | kebab-case | `skill-loader.ts` |
| Test files | kebab-case + `.test.ts` | `skill-loader.test.ts` |
| Types/Interfaces | PascalCase | `AgentEvent`, `ToolHandler` |
| Functions | camelCase | `generateId()`, `projectState()` |
| Constants | SCREAMING_SNAKE_CASE | `DEFAULT_TIMEOUT_MS` |

---

## Appendix: Example Session Flow

Here's a complete example of how a coding session flows through Arcan OS:

### 1. User Submits Prompt

```http
POST /v1/runs
{
  "sessionId": "session_123",
  "prompt": "Add error handling to the skill loader",
  "skills": ["typescript-refactoring", "error-handling"]
}
```

### 2. System Assembles Context

```typescript
const context = await contextAssembler.assemble({
  sessionId: 'session_123',
  skills: ['typescript-refactoring', 'error-handling'],
  workspace: '/path/to/project'
});

// Context includes:
// - Base system prompt
// - Project conventions from CLAUDE.md
// - Skills content
// - Message history (from events)
// - Working memory (observations + reflections)
```

### 3. Agent Loop Starts

```typescript
const stream = streamText({
  model: anthropic('claude-3-5-sonnet-20241022'),
  messages: context.messages,
  tools: toolKernel.getTools(),
  maxSteps: 25,
  needsApproval: ({ toolName, args }) =>
    toolKernel.needsApproval(toolName, args)
});
```

### 4. Agent Reads Current Code

```
Event: tool.call
{
  callId: "call_001",
  toolId: "repo.read",
  args: { path: "packages/skills/src/skill-loader.ts" }
}

Event: tool.result
{
  callId: "call_001",
  result: { content: "..." }
}
```

### 5. Agent Proposes Changes

```
Event: tool.call
{
  callId: "call_002",
  toolId: "repo.patch",
  args: {
    edits: [{
      path: "packages/skills/src/skill-loader.ts",
      oldText: "const content = await fs.readFile(path);",
      newText: "const content = await fs.readFile(path).catch(err => { throw new Error(`Failed to read skill: ${err.message}`); });"
    }]
  }
}
```

### 6. Policy Engine Evaluates

```typescript
const decision = policyEngine.evaluate('repo.patch', args);
// decision = 'preview' (write operation, show diff first)
```

### 7. Approval Requested

```
Event: approval.requested
{
  approvalId: "approval_001",
  callId: "call_002",
  toolId: "repo.patch",
  args: { ... },
  preview: {
    filesAffected: 1,
    linesChanged: 1,
    diff: "..."
  }
}

Event: run.paused
{
  reason: "approval",
  approvalId: "approval_001"
}
```

### 8. Human Approves

```http
POST /v1/approvals/approval_001
{
  "decision": "approve",
  "reason": "Error handling looks good"
}
```

```
Event: approval.resolved
{
  approvalId: "approval_001",
  decision: "approve",
  resolvedBy: "user_123"
}

Event: run.resumed
{
  resumedFrom: "approval"
}
```

### 9. Tool Executes

```
Event: tool.result
{
  callId: "call_002",
  result: { success: true, filesModified: 1 }
}
```

### 10. Auto-Format Hook Fires

```
PostToolUse hook triggered:
  command: "bunx biome check --write ."

File formatted automatically.
```

### 11. Agent Completes

```
Event: output.message
{
  role: "assistant",
  content: "I've added error handling to the skill loader..."
}

Event: run.completed
{
  summary: "Added error handling to skill loader",
  totalSteps: 2,
  totalTokens: { input: 1500, output: 300 }
}
```

### 12. Memory Observes

```typescript
await memoryService.observe(runId, 0);

// Extracts:
// - Observation: "Successfully modified skill-loader.ts"
// - Observation: "Error handling pattern: wrap fs operations in try-catch"
```

### 13. State is Projected

```typescript
const runState = projectRunState(events);

// Materialized view:
{
  runId: "run_456",
  sessionId: "session_123",
  status: "completed",
  startedAt: 1234567890,
  completedAt: 1234567999,
  steps: 2,
  toolCalls: [
    { id: "call_001", tool: "repo.read", status: "completed" },
    { id: "call_002", tool: "repo.patch", status: "completed", approved: true }
  ]
}
```

---

## Conclusion

This guide provides the foundational principles, patterns, and practices for building safe, observable, and maintainable AI agent systems. The key takeaways:

1. **Separate planning from execution** — the LLM proposes, the OS enforces
2. **Everything is an event** — state is derived, not stored
3. **Context is configuration** — use files, not just prompts
4. **Security by mechanism** — policies, not instructions
5. **Observable by default** — trace every action

By following these principles, you can build agentic systems that are:

- **Safe**: Approval gates and policy enforcement prevent dangerous actions
- **Observable**: Every action is recorded in an immutable log
- **Debuggable**: Replay events to understand what happened
- **Maintainable**: Context and conventions are version-controlled
- **Governable**: Human oversight at critical decision points

Use this guide as your reference when designing agent workflows, implementing tools, structuring context, or debugging agent behavior.

---

**Document Version**: 1.0.0
**Project**: Arcan OS
**License**: MIT
**Maintained By**: Arcan OS Contributors
