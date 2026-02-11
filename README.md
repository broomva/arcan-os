# Agent OS

**Agent OS** is a modular, event-sourced runtime for AI coding agents. It provides a robust foundation for orchestrating AI assistants, managing their lifecycle, and enforcing safety policies through a strict event-driven architecture.

## Features

- **Event-Sourced State**: The complete history of the agent's memory and actions is stored as an immutable event stream.
- **Modular Kernel**: Capabilities are injected as tools and skills, allowing for flexible agent configurations.
- **Safety First**: A `ToolKernel` enforces policy checks (allow/deny/approve) on all agent actions.
- **Type-Safe**: Built with TypeScript, Zod, and T3 Env for end-to-end type safety.
- **Observability**: OpenTelemetry integration for tracing agent thought processes and tool execution.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **monorepo**: [Turborepo](https://turbo.build)
- **AI Engine**: [Vercel AI SDK](https://sdk.vercel.ai/docs)
- **Server**: [Elysia](https://elysiajs.com)
- **Database**: SQLite (via `bun:sqlite`)
- **Linting**: [Biome](https://biomejs.dev)

## Project Structure

```bash
agent-os/
├── apps/
│   └── daemon/            # HTTP/SSE Server & Agent Runtime
├── packages/
│   ├── core/              # Shared domain types & event schemas
│   ├── tool-kernel/       # Capability registry & policy engine
│   ├── event-store/       # SQLite event ledger
│   ├── run-manager/       # Run lifecycle state machine
│   ├── engine-adapter/    # AI SDK integration
│   ├── skills/            # Skill loader & registry
│   └── tsconfig/          # Shared TypeScript configuration
└── docs/                  # Architecture documentation
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.1+) installed.

### Installation

```bash
# Install dependencies
bun install
```

### Development

```bash
# Start the daemon
bun run dev

# Run tests
bun test

# Typecheck
bun run typecheck

# Lint and Format
bun run check
```

## AI Development

If you are an AI assistant working on this codebase:
- **Cursor**: Read `.cursorrules` for coding standards.
- **Claude Code**: Read `CLAUDE.md` for project context and commands.
- **General**: Refer to `AGENTS.md` for architectural deep dives.

## License

MIT
