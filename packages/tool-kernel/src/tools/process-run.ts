/**
 * process.run — Execute a subprocess command
 * (V1 spec §37: process.run(command, cwd?))
 */

import { resolve } from 'node:path';
import type { ToolContext, ToolHandler } from '@arcan-os/core';
import { z } from 'zod';

export const inputSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  cwd: z
    .string()
    .optional()
    .describe('Working directory (relative to workspace root)'),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export const processRun: ToolHandler<Input, Output> = {
  id: 'process.run',
  description:
    'Execute a shell command in the workspace. Returns stdout, stderr, and exit code.',
  inputSchema,
  category: 'exec',

  async execute(input: Input, ctx: ToolContext): Promise<Output> {
    const cwd = input.cwd
      ? resolve(ctx.workspaceRoot, input.cwd)
      : ctx.workspaceRoot;

    const start = performance.now();

    const proc = Bun.spawn(['sh', '-c', input.command], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      signal: ctx.signal,
      env: {
        ...process.env,
        PAGER: 'cat', // Prevent interactive pagers
      },
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;
    const durationMs = Math.round(performance.now() - start);

    return {
      exitCode,
      stdout,
      stderr,
      durationMs,
    };
  },
};
