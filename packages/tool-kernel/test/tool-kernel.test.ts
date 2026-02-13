/**
 * @arcan-os/tool-kernel — Tests
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PolicyEngine } from '../src/policy-engine.js';
import { ToolKernel } from '../src/tool-kernel.js';
import { processRun } from '../src/tools/process-run.js';
import { repoEdit } from '../src/tools/repo-edit.js';
import { repoPatch } from '../src/tools/repo-patch.js';
import { repoRead } from '../src/tools/repo-read.js';

const TEST_DIR = join(import.meta.dir, '__test_workspace__');

function setup() {
  mkdirSync(join(TEST_DIR, 'src'), { recursive: true });
  writeFileSync(
    join(TEST_DIR, 'src', 'hello.ts'),
    'const x = 1;\nconst y = 2;\nconst z = 3;\n',
  );
  writeFileSync(join(TEST_DIR, 'README.md'), '# Test Project\n');
}

function teardown() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// =========================================================================
// PolicyEngine tests
// =========================================================================

describe('PolicyEngine', () => {
  it('loads default policy when no workspace provided', () => {
    const engine = new PolicyEngine();
    const config = engine.getConfig();

    expect(config.capabilities['repo.read'].approval).toBe('never');
    expect(config.capabilities['repo.patch'].approval).toBe('always');
    expect(config.capabilities['process.run'].approval).toBe('risk');
  });

  it('returns correct control path for read tools', () => {
    const engine = new PolicyEngine();
    const risk = {
      toolId: 'repo.read',
      category: 'read' as const,
      estimatedImpact: 'small' as const,
      touchesSecrets: false,
      touchesConfig: false,
      touchesBuild: false,
    };
    expect(engine.getControlPath('repo.read', risk)).toBe('auto');
  });

  it('returns approval for always-approve tools', () => {
    const engine = new PolicyEngine();
    const risk = {
      toolId: 'repo.patch',
      category: 'write' as const,
      estimatedImpact: 'medium' as const,
      touchesSecrets: false,
      touchesConfig: false,
      touchesBuild: false,
    };
    expect(engine.getControlPath('repo.patch', risk)).toBe('approval');
  });

  it('escalates risk-based tools on high impact', () => {
    const engine = new PolicyEngine();
    const risk = {
      toolId: 'process.run',
      category: 'exec' as const,
      estimatedImpact: 'large' as const,
      touchesSecrets: false,
      touchesConfig: false,
      touchesBuild: false,
    };
    expect(engine.getControlPath('process.run', risk)).toBe('approval');
  });
});

// =========================================================================
// ToolKernel tests
// =========================================================================

describe('ToolKernel', () => {
  let kernel: ToolKernel;

  beforeEach(() => {
    setup();
    kernel = new ToolKernel(TEST_DIR);
    kernel.register(repoRead);
    kernel.register(repoPatch);
    kernel.register(repoEdit);
    kernel.register(processRun);
  });

  afterEach(() => {
    teardown();
  });

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  describe('registration', () => {
    it('registers and retrieves tools', () => {
      expect(kernel.getTool('repo.read')).toBeDefined();
      expect(kernel.getTools()).toHaveLength(4);
    });

    it('rejects duplicate registration', () => {
      expect(() => kernel.register(repoRead)).toThrow('already registered');
    });
  });

  // -----------------------------------------------------------------------
  // Workspace jail
  // -----------------------------------------------------------------------

  describe('workspace jail', () => {
    it('validates paths within workspace', () => {
      const resolved = kernel.validatePath('src/hello.ts');
      expect(resolved).toContain('src/hello.ts');
    });

    it('rejects paths that escape the workspace', () => {
      expect(() => kernel.validatePath('../../etc/passwd')).toThrow(
        'escapes workspace',
      );
    });

    it('rejects paths matching deny patterns', () => {
      expect(() => kernel.validatePath('.git/config')).toThrow('deny pattern');
    });
  });

  // -----------------------------------------------------------------------
  // Risk assessment
  // -----------------------------------------------------------------------

  describe('risk assessment', () => {
    it('assesses read tools as low risk', () => {
      const risk = kernel.assessRisk('repo.read', { path: 'src/hello.ts' });
      expect(risk.category).toBe('read');
      expect(risk.estimatedImpact).toBe('small');
    });

    it('detects secrets in file paths', () => {
      const risk = kernel.assessRisk('repo.read', { path: '.env.SECRET' });
      expect(risk.touchesSecrets).toBe(true);
    });

    it('detects config files', () => {
      const risk = kernel.assessRisk('repo.patch', { path: 'package.json' });
      expect(risk.touchesConfig).toBe(true);
    });

    it('flags high-risk commands', () => {
      const risk = kernel.assessRisk('process.run', { command: 'rm -rf /' });
      expect(risk.estimatedImpact).toBe('large');
    });
  });

  // -----------------------------------------------------------------------
  // needsApproval
  // -----------------------------------------------------------------------

  describe('needsApproval', () => {
    it('returns false for read tools', () => {
      expect(kernel.needsApproval('repo.read', { path: 'test.ts' })).toBe(
        false,
      );
    });

    it('returns true for write tools', () => {
      expect(kernel.needsApproval('repo.patch', { path: 'test.ts' })).toBe(
        true,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Tool execution
  // -----------------------------------------------------------------------

  describe('execute', () => {
    it('executes repo.read successfully', async () => {
      const result = (await kernel.execute(
        'repo.read',
        { path: 'src/hello.ts' },
        'r1',
        's1',
      )) as { content: string; totalLines: number };
      expect(result.content).toContain('const x = 1');
      expect(result.totalLines).toBe(4); // 3 lines + trailing newline
    });

    it('executes repo.read with line range', async () => {
      const result = (await kernel.execute(
        'repo.read',
        { path: 'src/hello.ts', startLine: 2, endLine: 2 },
        'r1',
        's1',
      )) as { content: string; range: object };
      expect(result.content).toBe('const y = 2;');
      expect(result.range).toEqual({ start: 2, end: 2 });
    });

    it('returns line anchors for robust edit workflows', async () => {
      const result = (await kernel.execute(
        'repo.read',
        {
          path: 'src/hello.ts',
          startLine: 1,
          endLine: 2,
          includeAnchors: true,
        },
        'r1',
        's1',
      )) as {
        content: string;
        anchors: Array<{ line: number; hash: string }>;
      };

      expect(result.content).toBe('const x = 1;\nconst y = 2;');
      expect(result.anchors).toEqual([
        { line: 1, hash: '749b17' },
        { line: 2, hash: 'e6e113' },
      ]);
    });

    it('executes repo.patch to create a new file', async () => {
      const result = (await kernel.execute(
        'repo.patch',
        { path: 'src/new-file.ts', content: 'export const hello = "world";\n' },
        'r1',
        's1',
      )) as { created: boolean; linesChanged: number };
      expect(result.created).toBe(true);
      expect(result.linesChanged).toBeGreaterThan(0);
    });

    it('executes repo.edit replace-line with anchor hash', async () => {
      const result = (await kernel.execute(
        'repo.edit',
        {
          path: 'src/hello.ts',
          operations: [
            {
              kind: 'replace-line',
              line: 1,
              expectedHash: '749b17',
              content: 'const x = 10;',
            },
          ],
        },
        'r1',
        's1',
      )) as { appliedOperations: number; failedOperations: unknown[] };

      expect(result.appliedOperations).toBe(1);
      expect(result.failedOperations).toHaveLength(0);

      const read = (await kernel.execute(
        'repo.read',
        { path: 'src/hello.ts', startLine: 1, endLine: 1 },
        'r1',
        's1',
      )) as { content: string };
      expect(read.content).toBe('const x = 10;');
    });

    it('returns anchor-mismatch for stale anchored edit', async () => {
      const result = (await kernel.execute(
        'repo.edit',
        {
          path: 'src/hello.ts',
          operations: [
            {
              kind: 'replace-line',
              line: 1,
              expectedHash: 'deadbe',
              content: 'const x = 99;',
            },
          ],
        },
        'r1',
        's1',
      )) as {
        appliedOperations: number;
        failedOperations: Array<{ code: string }>;
      };

      expect(result.appliedOperations).toBe(0);
      expect(result.failedOperations).toHaveLength(1);
      expect(result.failedOperations[0]?.code).toBe('anchor-mismatch');
    });

    it('uses atomic mode by default to avoid partial writes', async () => {
      const result = (await kernel.execute(
        'repo.edit',
        {
          path: 'src/hello.ts',
          operations: [
            {
              kind: 'replace-line',
              line: 1,
              expectedHash: '749b17',
              content: 'const x = 11;',
            },
            {
              kind: 'replace-line',
              line: 2,
              expectedHash: 'badbad',
              content: 'const y = 22;',
            },
          ],
        },
        'r1',
        's1',
      )) as {
        appliedOperations: number;
        failedOperations: Array<{ code: string; anchorWindow?: unknown[] }>;
      };

      expect(result.appliedOperations).toBe(0);
      expect(result.failedOperations).toHaveLength(1);
      expect(result.failedOperations[0]?.code).toBe('anchor-mismatch');
      expect(result.failedOperations[0]?.anchorWindow?.length).toBeGreaterThan(
        0,
      );

      const read = (await kernel.execute(
        'repo.read',
        { path: 'src/hello.ts', startLine: 1, endLine: 1 },
        'r1',
        's1',
      )) as { content: string };
      expect(read.content).toBe('const x = 1;');
    });

    it('supports best-effort mode for partial success edits', async () => {
      const result = (await kernel.execute(
        'repo.edit',
        {
          path: 'src/hello.ts',
          mode: 'best-effort',
          operations: [
            {
              kind: 'replace-line',
              line: 1,
              expectedHash: '749b17',
              content: 'const x = 11;',
            },
            {
              kind: 'replace-line',
              line: 2,
              expectedHash: 'badbad',
              content: 'const y = 22;',
            },
          ],
        },
        'r1',
        's1',
      )) as {
        appliedOperations: number;
        failedOperations: Array<{ code: string }>;
      };

      expect(result.appliedOperations).toBe(1);
      expect(result.failedOperations).toHaveLength(1);

      const read = (await kernel.execute(
        'repo.read',
        { path: 'src/hello.ts', startLine: 1, endLine: 1 },
        'r1',
        's1',
      )) as { content: string };
      expect(read.content).toBe('const x = 11;');
    });

    it('executes process.run', async () => {
      const result = (await kernel.execute(
        'process.run',
        { command: 'echo hello' },
        'r1',
        's1',
      )) as { exitCode: number; stdout: string };
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
    });

    it('rejects unknown tools', async () => {
      await expect(
        kernel.execute('unknown.tool', {}, 'r1', 's1'),
      ).rejects.toThrow('Unknown tool');
    });
  });
});
