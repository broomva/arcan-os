# Code Style Rules

## Language & Runtime

- **TypeScript strict mode** — All code must use `"strict": true`
- **Bun runtime** — Use Bun for package management, testing, and execution
- **ESNext target** — Modern JavaScript features enabled

## Formatting & Linting

**Always run before committing:**
```bash
bunx biome check --write .
```

Biome handles both formatting and linting. Do not introduce Prettier, ESLint, or other formatters.

## File Naming

- **kebab-case** for files: `skill-loader.ts`, `ai-sdk-engine.ts`
- **PascalCase** for types/interfaces: `AgentEvent`, `ToolHandler`
- **camelCase** for functions/variables: `generateId()`, `toolKernel`

## Module Structure

- Each package has `src/index.ts` as barrel export
- Use explicit imports, no wildcards: `import { X } from './foo'`
- Prefer relative imports within packages
- Use `workspace:*` for internal package dependencies

## Error Handling

- Throw descriptive `Error` objects with clear messages
- Catch at boundaries (HTTP handlers, tool executors)
- No swallowed errors — always log or propagate

## Comments

- Use `// ---` divider lines for section headers
- Document complex logic inline
- Avoid obvious comments (`// increment i` is noise)
- Prefer self-documenting code over comments
