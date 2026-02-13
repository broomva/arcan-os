# Monorepo Guidelines

## Workspace Structure

```
arcan-os/
├── packages/       # Shared libraries
│   ├── core/      # Foundation types (no deps)
│   ├── event-store/
│   ├── run-manager/
│   ├── tool-kernel/
│   ├── engine-adapter/
│   ├── skills/
│   ├── context/
│   └── observability/
├── apps/
│   ├── arcand/    # HTTP/SSE server (daemon)
│   └── cli/       # Interactive CLI
```

## Dependency Rules

- `@arcan-os/core` is the foundation — zero dependencies
- All other packages depend on core
- Use `workspace:*` for internal package references
- Run `bun install` at root to link workspaces

## Build Orchestration

**Turborepo** orchestrates builds with caching:

```bash
bun run build       # Build all packages
bun run typecheck   # Type check all packages
bun run clean       # Remove build artifacts
```

## Adding a New Package

1. Create `packages/<name>/package.json` with `"name": "@arcan-os/<name>"`
2. Create `packages/<name>/tsconfig.json` extending root config
3. Create `packages/<name>/src/index.ts` as barrel export
4. Create `packages/<name>/test/<name>.test.ts`
5. Add `workspace:*` deps in consuming packages
6. Run `bun install` to link

## Package Dependency Graph

```
core (no deps)
  ↑
event-store ← run-manager
  ↑               ↑
tool-kernel    engine-adapter ← context ← skills
  ↑               ↑               ↑
  └───────── arcand ← observability
```

Do not create circular dependencies or bypass this hierarchy.
