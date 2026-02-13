# AGENTS.md — Arcan OS

> Context document for AI coding agents working on this codebase.
> Read this file first before making any changes.

## Project Overview

Arcan OS is a **modular, event-sourced agent runtime** that orchestrates AI coding assistants. It wraps Vercel's AI SDK to provide run management, tool execution with policy enforcement, approval gates, observability, and skills injection — all connected through an append-only event stream.

**Design philosophy:** The agent's message history IS the application state. Every action produces immutable events; the system's state is a projection of its event log.

### Key Design Documents

- `docs/ARCAN_OS_V1.md` — V1 specification (referenced as "§" sections throughout the code)
- `docs/ARCAN_OS_KERNEL.md` — Kernel architecture overview
- `docs/OPENAI_CODEX_ARCHITECTURE_ANALYSIS.md` — Reference architecture analysis

### AI Assistant Guidelines
- **Cursor**: Follow `.cursorrules` for coding standards.
- **Claude Code**: Refer to `CLAUDE.md` for project commands.
- **Linter**: Run `bun run check` to verify code quality (Biome).
- **Fixes**: Run `bun run format` to auto-fix formatting, or `bun run lint:fix` to apply safe fixes.
- **Rules**:
  - All new code must have valid tests.
  - All code must pass `bun run check` (Biome linting/formatting).
  - All code must pass `bun run typecheck` (Strict TypeScript).
  - The full project must build successfully via `bun run build`.
  - Commits that fail these checks will be rejected by pre-commit hooks.

### Claude Code Configuration

This project uses comprehensive Claude Code settings for automation and security:

**Configuration Files:**
- `.claude/settings.local.json` — Permissions, hooks, and local settings (gitignored)
- `.claude/rules/` — Topic-specific guidelines (code-style, testing, monorepo)
- `CLAUDE.md` — Quick reference and commands

**Automated Hooks:**
- **SessionStart (compact)**: Re-injects project conventions after context compaction
- **PostToolUse (Write/Edit)**: Auto-formats code with Biome after file modifications
- **Stop**: Reminds to verify formatting, types, and tests after task completion

**Security & Permissions:**
- **Deny rules**: Blocks access to `.env` files, secrets directories, `.git/config`, and lockfiles
- **Allow rules**: Pre-approved commands for Bun, Git, testing, and documentation fetching
- **Defense-in-depth**: Multiple layers of protection for sensitive files

**Topic-Specific Rules:**
See `.claude/rules/` for detailed guidelines on:
- Code style and naming conventions
- Testing structure and coverage requirements
- Monorepo workspace dependencies

### Pre-Commit Workflow for AI Agents

**IMPORTANT**: Before committing any code changes, AI agents MUST follow this workflow:

#### For All Changes
1. **Auto-fix linting and formatting:**
   ```bash
   bunx biome check --write .
   ```
   This fixes formatting issues and safe lint violations automatically.

2. **Verify type safety:**
   ```bash
   bun run typecheck
   ```
   All TypeScript errors must be resolved before committing.

#### For Larger Implementations (New Features, Refactors)
Additionally run:

3. **Verify tests pass:**
   ```bash
   bun test
   ```
   All existing tests must pass. Add new tests for new functionality.

4. **Verify build succeeds:**
   ```bash
   bun run build
   ```
   The entire monorepo must build without errors.

#### Commit Pattern
```bash
# 1. Fix formatting and linting
bunx biome check --write .

# 2. Stage changes
git add <files>

# 3. Commit (pre-commit hooks will run checks automatically)
git commit -m "feat: description"
```

**Note**: The pre-commit hook will automatically run `bun run check` and `bun run typecheck`. If you've already run these manually and fixed all issues, the commit will succeed immediately.

---

## Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | **Bun** | Package manager, test runner, and runtime |
| Build orchestrator | **Turborepo** | Workspace task orchestration |
| Language | **TypeScript** (strict mode, ESNext) | All packages use `"strict": true` |
| AI Engine | **Vercel AI SDK** (`streamText` + `maxSteps`) | ToolLoopAgent pattern |
| HTTP Server | **Elysia** | SSE streaming, type-safe routes |
| Database | **SQLite** (via `bun:sqlite`) | WAL mode, append-only event store |
| Schema validation | **Zod** | Tool input schemas, event payloads |
| Observability | **OpenTelemetry** | With LangSmith OTLP exporter |
| Skills format | **skills.sh** compatible | `SKILL.md` with YAML frontmatter |

---

## Monorepo Structure

```
arcan-os/
├── packages/
│   ├── core/              # Shared types — events, run, tools, engine, snapshots
│   ├── event-store/       # Append-only SQLite ledger + snapshots
│   ├── run-manager/       # Run lifecycle state machine + approval gate
│   ├── tool-kernel/       # Policy engine + capability tools (read/search/patch/exec)
│   ├── engine-adapter/    # AI SDK streamText wrapper → AgentEvent bridge
│   ├── skills/            # Skill loader, registry, injector (skills.sh compatible)
│   ├── context/           # Context assembler + message history projection
│   └── observability/     # OTel setup + LangSmith exporter + EventTracer
├── apps/
│   └── arcand/            # Elysia HTTP/SSE server (agentd)
├── docs/                  # Design specifications
├── turbo.json             # Task pipeline
├── tsconfig.json          # Shared TypeScript config
└── package.json           # Workspace root
```

### Package Dependency Graph

```
core (no deps — shared types)
  ↑
event-store ← run-manager
  ↑               ↑
tool-kernel    engine-adapter ← context ← skills
  ↑               ↑               ↑
  └───────── arcand (integration point) ← observability
```

All packages use `workspace:*` for internal dependencies. The `@arcan-os/core` package is the foundation — every other package depends on it.

---

## Core Concepts

### Event System (`packages/core/src/events.ts`)

18 event types organized by domain:

| Domain | Events |
|---|---|
| Run lifecycle | `run.started`, `run.completed`, `run.failed`, `run.paused`, `run.resumed` |
| Output | `output.delta`, `output.message` |
| Tool execution | `tool.call`, `tool.result` |
| Approval gate | `approval.requested`, `approval.resolved` |
| Artifacts | `artifact.emitted` |
| Checkpoints | `checkpoint.created`, `state.snapshot` |
| Engine | `engine.request`, `engine.response` |
| Memory | `working_memory.snapshot` |

Every event has an envelope: `{ eventId, runId, sessionId, seq, ts, type, payload }`.

### Run State Machine (`packages/core/src/run.ts`)

```
created → running → paused ↔ running → completed
                                      → failed
```

Runs are locked to one per session (session queue).

### Tool Categories & Risk (`packages/core/src/tools.ts`)

Tools have categories: `read`, `write`, `exec`, `network`. The `PolicyEngine` maps each category to a control path:

| Control Path | Behavior |
|---|---|
| `auto` | Execute immediately |
| `approval` | Pause for human approval |
| `preview` | Show preview, then approve |
| `deny` | Block execution |

### Agent Loop Pattern

The agent loop is implemented via AI SDK's `streamText` with `maxSteps`. This IS the ToolLoopAgent — no custom loop needed:

```typescript
streamText({
  model,
  messages,
  tools,
  maxSteps: 25,  // ← multi-step agent loop
  needsApproval: ({ toolName, args }) => {
    return toolKernel.needsApproval(toolName, args);
  },
  experimental_telemetry: { isEnabled: true, ... },
});
```

---

## Development Practices

### Commands

```bash
# Install dependencies
bun install

# Run all tests
bun run test               # Turbo orchestrated
# Or per-package:
cd packages/skills && bun test

# Type check
bun run typecheck

# Dev server (arcand)
cd apps/arcand && bun run dev

# Clean build artifacts
bun run clean
```

### Testing

- **Test runner:** `bun test` (Bun's built-in test runner)
- **Test imports:** `import { describe, expect, it } from 'bun:test'`
- **Test location:** `<package>/test/<name>.test.ts`
- **E2E tests:** `apps/arcand/test/e2e.test.ts` — exercises the full stack
- **HTTP testing:** Use Elysia's `app.handle(new Request(...))` — no live server needed
- **Current count:** 108 tests across 8 files, all passing

### Code Conventions

1. **Module structure:** Each package has `src/index.ts` as a barrel export
2. **File naming:** kebab-case (`skill-loader.ts`, `ai-sdk-engine.ts`)
3. **Type exports:** Export interfaces/types alongside implementations
4. **Error handling:** Throw descriptive `Error` with message, catch at boundaries
5. **IDs:** Use `generateId()` from `@arcan-os/core` (returns ULIDs)
6. **Timestamps:** Use `now()` from `@arcan-os/core` (returns `Date.now()`)
7. **Async generators:** Engine adapter uses `async *run()` yielding `AgentEvent`s
8. **Comments:** Section headers use `// ---` divider lines for visual grouping

### Adding a New Package

1. Create `packages/<name>/package.json` with `"name": "@arcan-os/<name>"`
2. Create `packages/<name>/tsconfig.json` extending root config
3. Create `packages/<name>/src/index.ts` as barrel export
4. Create `packages/<name>/test/<name>.test.ts`
5. Add `workspace:*` deps to consuming packages
6. Run `bun install` to link

### Adding a New Tool

1. Create `packages/tool-kernel/src/tools/<tool-name>.ts`
2. Define a Zod `inputSchema` and an `Output` interface
3. Export a `ToolHandler` object with `id`, `description`, `inputSchema`, `category`, `execute`
4. Register in `apps/arcand/src/server.ts` via `toolKernel.register(myTool)`
5. Tool IDs follow `domain.action` convention: `repo.read`, `process.run`

### Adding a New Skill

Skills are `SKILL.md` files with YAML frontmatter:

```markdown
---
name: my-skill
description: What this skill does
version: 1.0.0
---
# My Skill

Instruction content for the LLM...
```

Place in one of these directories (priority order):
1. `.agent/skills/<skill-name>/SKILL.md` — workspace-local (highest priority)
2. `.skills/<skill-name>/SKILL.md` — installed via `npx skills add`
3. `~/.arcan-os/skills/<skill-name>/SKILL.md` — global

---

## API Reference (Daemon)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/v1/health` | Health check |
| `POST` | `/v1/runs` | Create and start a run |
| `GET` | `/v1/runs/:runId/events` | SSE event stream with replay (`Last-Event-ID`) |
| `POST` | `/v1/approvals/:approvalId` | Resolve a pending approval (`approve` / `deny`) |
| `GET` | `/v1/sessions/:sessionId/state` | Materialized state (snapshot + pending events) |

### POST /v1/runs

```json
{
  "sessionId": "string (required)",
  "prompt": "string (required)",
  "model": "string (optional)",
  "workspace": "string (optional)",
  "skills": ["string[] (optional)"],
  "maxSteps": "number (optional)"
}
```

### POST /v1/approvals/:approvalId

```json
{
  "decision": "approve | deny",
  "reason": "string (optional)"
}
```

---

## Observability

The system supports two complementary tracing paths:

1. **AI SDK Telemetry** — `experimental_telemetry` on `streamText` emits OTel spans for LLM calls, tool invocations, and streaming. These go directly to any OTel-compatible collector.

2. **EventTracer** — `packages/observability/src/event-tracer.ts` bridges Arcan OS events (run lifecycle, tool calls, approvals) to OTel spans for non-AI-SDK activity.

### LangSmith Setup

LangSmith accepts OTel traces at its OTLP endpoint. Configure via:

```typescript
setupTelemetry({
  langsmith: {
    apiKey: process.env.LANGSMITH_API_KEY,
    project: 'arcan-os',
  },
});
```

---

## Architecture Decisions

| Decision | Rationale |
|---|---|
| **Event-sourced state** | Agent message history IS the app state. Immutable log enables replay, debugging, auditability |
| **AI SDK (not Mastra)** | Direct control over the agent loop via `streamText` + `maxSteps`. Mastra adds orchestration overhead we don't need |
| **SQLite for events** | WAL mode, zero-config, single-file. Perfect for local-first arcand |
| **Elysia (not Hono)** | Superior Bun integration, built-in type inference, native SSE support |
| **`provider.getTracer()` over global** | OTel's global `trace` provider can only be set once. Using provider instance directly ensures each setup returns a working tracer |
| **Skills as SKILL.md** | Compatible with skills.sh ecosystem. Multi-source discovery with priority ordering |

---

## Known Limitations (V1)

- No persistent memory across sessions (working memory is ephemeral)
- No multi-agent orchestration (single agent per session)
- Engine adapter has no real LLM integration tests (mocking only)
- No built-in auth/authz on arcand endpoints
- SQLite limits horizontal scaling (single-writer)
