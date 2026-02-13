# Testing Rules

## Test Runner

**Bun test** is the test runner. Do not use Jest, Vitest, or others.

```bash
bun test                    # Run all tests
cd packages/skills && bun test  # Run package tests
```

## Test Structure

```typescript
import { describe, expect, it } from 'bun:test';

describe('MyModule', () => {
  it('should do something', () => {
    expect(result).toBe(expected);
  });
});
```

## Test Location

- Place tests in `<package>/test/<name>.test.ts`
- E2E tests go in `apps/arcand/test/e2e.test.ts`
- Keep unit tests close to the code they test

## HTTP Testing

Use Elysia's `app.handle()` for HTTP testing:

```typescript
const response = await app.handle(
  new Request('http://localhost/v1/health')
);
expect(response.status).toBe(200);
```

No live server needed for testing routes.

## Coverage Requirements

- All new features require tests
- Bug fixes should include regression tests
- Tests must pass before committing: `bun test`

## Current Test Status

108 tests across 8 files — all passing. Keep it that way.
