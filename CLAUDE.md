# Claude Code Configuration

## Project Context
Arcan OS is an event-sourced AI agent runtime. It stores agent interactions as an immutable event stream in SQLite.

## Hooks & Automation

Configured in `.claude/settings.local.json`:

- **SessionStart**: Re-inject conventions after context compaction
- **PostToolUse (Write/Edit)**: Auto-format with Biome
- **UserPromptSubmit**: Log task start
- **Stop**: Remind to verify formatting, types, tests

All formatting happens automatically — you don't need to run Biome manually.

## Topic-Specific Rules

Additional guidelines in `.claude/rules/`:
- `code-style.md` — Naming, formatting, error handling
- `testing.md` — Test runner, structure, coverage
- `monorepo.md` — Workspace structure, dependencies

## Commands

### Build
```bash
bun run build
```

### Test
```bash
bun test
```

### Lint/Format
```bash
bun run check           # Check without fixing
bunx biome check --write .  # Auto-fix formatting and safe lint issues
```

### Typecheck
```bash
bun run typecheck       # Verify TypeScript types
```

## Pre-Commit Workflow

Before committing, always run:
```bash
bunx biome check --write .  # Auto-fix formatting
bun run typecheck          # Verify types
```

For larger changes, also run:
```bash
bun test               # Verify tests pass
bun run build          # Verify build succeeds
```

See `AGENTS.md` for detailed pre-commit workflow guidelines.

## Style Guide
- **Language**: TypeScript
- **Runtime**: Bun
- **Style**: Functional where possible, strict types.
- **Imports**: Use explicit extensions or path aliases if configured, but generally prefer relative imports within packages.

## Architecture
- **Event-Sourced**: State is derived from events.
- **Tools**: Tools are pure functions or classes wrapping external capabilities, registered in the `ToolKernel`.
- **Skills**: Skills are markdown files injected into the context.
