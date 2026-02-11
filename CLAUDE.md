# Claude Code Configuration

## Project Context
Agent OS is an event-sourced AI agent runtime. It stores agent interactions as an immutable event stream in SQLite.

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
bun run check
```

## Style Guide
- **Language**: TypeScript
- **Runtime**: Bun
- **Style**: Functional where possible, strict types.
- **Imports**: Use explicit extensions or path aliases if configured, but generally prefer relative imports within packages.

## Architecture
- **Event-Sourced**: State is derived from events.
- **Tools**: Tools are pure functions or classes wrapping external capabilities, registered in the `ToolKernel`.
- **Skills**: Skills are markdown files injected into the context.
